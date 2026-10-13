import { FieldValue, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { escapeHtml, sendEmail } from '../lib/email.js';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';
import type { CreateEmployeeInput, UpdateEmployeeInput } from '../schemas/employees.js';
import { disconnectUser } from '../socket/index.js';
import { codeRef } from './access-code.js';
import { recordActivity } from './activity.js';
import { assertCanAccess } from './authz.js';
import { issueSetupToken, setupTokens, setupUrl } from './setup-token.js';
import { getUser, toPublicUser, users, type PublicUser } from './users.js';

// Firestore has no unique constraints. Each email/phone in use owns a doc here, created and deleted in the
// same transaction as the user, so two concurrent requests can't both claim the same value.
type UniqueField = 'email' | 'phone';
const uniqueRef = (field: UniqueField, value: string) =>
  db.collection('uniques').doc(`${field}:${value}`);

async function assertAvailable(tx: Transaction, claims: [UniqueField, string][]) {
  if (!claims.length) return;
  const snaps = await tx.getAll(...claims.map(([field, value]) => uniqueRef(field, value)));
  const taken = claims.filter((_, i) => snaps[i].exists).map(([field]) => field);
  if (taken.length) {
    throw new AppError(
      'CONFLICT',
      `${taken.join(' and ')} already in use`,
      409,
      taken.map((path) => ({ path })),
    );
  }
}

const notFound = () => new AppError('NOT_FOUND', 'Employee not found', 404);

async function getEmployeeDoc(tx: Transaction, ref: DocumentReference) {
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data()!.role !== 'employee') throw notFound();
  return snap;
}

export type InviteResult = { inviteSent: boolean; setupUrl?: string };

// Never throws: the employee exists either way, and the owner can resend. In DEMO_MODE the link also goes back
// to the owner, so reviewers can onboard made-up addresses (Resend's test sender only reaches its own account).
async function sendInvite(
  to: { id: string; name: string; email: string },
  inviter: string,
  raw: string,
): Promise<InviteResult> {
  const url = setupUrl(raw);
  let inviteSent = true;
  try {
    await sendEmail({
      to: to.email,
      subject: "You're invited to Skipli",
      text: `Hi ${to.name},\n\n${inviter} added you to Skipli. Set up your account here:\n${url}\n\nThe link works once and expires in 48 hours.`,
      html: `<p>Hi ${escapeHtml(to.name)},</p><p>${escapeHtml(inviter)} added you to Skipli.</p><p><a href="${url}">Set up your account</a></p><p>The link works once and expires in 48 hours.</p>`,
    });
  } catch (err) {
    console.error(`invite email for employee ${to.id} failed:`, (err as Error).message);
    inviteSent = false;
  }
  return { inviteSent, ...(env.DEMO_MODE && { setupUrl: url }) };
}

export async function createEmployee(actor: AuthUser, input: CreateEmployeeInput) {
  const ref = users.doc();
  const raw = await db.runTransaction(async (tx) => {
    await assertAvailable(tx, [
      ['email', input.email],
      ...(input.phone ? [['phone', input.phone] as [UniqueField, string]] : []),
    ]);
    tx.create(ref, {
      role: 'employee',
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      department: input.department,
      title: input.title ?? '',
      username: null,
      passwordHash: null,
      status: 'invited',
      failedLogins: 0,
      lockedUntil: null,
      demo: false,
      createdBy: actor.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(uniqueRef('email', input.email), { userId: ref.id });
    if (input.phone) tx.create(uniqueRef('phone', input.phone), { userId: ref.id });
    recordActivity(tx, {
      actorId: actor.id,
      actorName: actor.name,
      action: 'employee.created',
      targetType: 'user',
      targetId: ref.id,
      targetName: input.name,
      visibility: 'feed',
    });
    return issueSetupToken(tx, ref.id);
  });
  const invite = await sendInvite({ id: ref.id, ...input }, actor.name, raw);
  return { employeeId: ref.id, ...invite };
}

export async function getEmployee(viewer: AuthUser, id: string): Promise<PublicUser> {
  assertCanAccess(viewer, id);
  const snap = await getUser(id);
  if (!snap || snap.data()!.role !== 'employee') throw notFound();
  return toPublicUser(snap);
}

// ponytail: whole collection, sorted in memory; one small team. Add a name index + cursor if it grows past a few hundred.
export async function listEmployees(): Promise<PublicUser[]> {
  const snap = await users.where('role', '==', 'employee').get();
  return snap.docs.map(toPublicUser).sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateEmployee(
  actor: AuthUser,
  id: string,
  patch: UpdateEmployeeInput,
): Promise<PublicUser> {
  const ref = users.doc(id);
  await db.runTransaction(async (tx) => {
    const current = (await getEmployeeDoc(tx, ref)).data()!;
    const changes: [UniqueField, string | null, string | null][] = [];
    if (patch.email !== undefined && patch.email !== current.email)
      changes.push(['email', current.email, patch.email]);
    if (patch.phone !== undefined && patch.phone !== current.phone)
      changes.push(['phone', current.phone ?? null, patch.phone]);
    await assertAvailable(
      tx,
      changes.filter(([, , next]) => next !== null).map(([field, , next]) => [field, next!]),
    );

    for (const [field, prev, next] of changes) {
      if (prev) tx.delete(uniqueRef(field, prev));
      if (next) tx.create(uniqueRef(field, next), { userId: id });
    }
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    recordActivity(tx, {
      actorId: actor.id,
      actorName: actor.name,
      action: 'employee.updated',
      targetType: 'user',
      targetId: id,
      targetName: patch.name ?? current.name,
      visibility: 'feed',
      metadata: { fields: Object.keys(patch) },
    });
  });
  return toPublicUser((await getUser(id))!);
}

// Hard delete: the user doc and everything that could still let them in (refresh tokens, setup links, a pending
// email code) go in one transaction, then their open sockets are dropped. requireAuth re-checks the account, so
// an access token they still hold stops working immediately. The activity entry keeps a copy of the name.
// Phase 3: unassign their open tasks in this same transaction.
export async function deleteEmployee(actor: AuthUser, id: string): Promise<void> {
  const ref = users.doc(id);
  await db.runTransaction(async (tx) => {
    const current = (await getEmployeeDoc(tx, ref)).data()!;
    const [refresh, setup] = await Promise.all([
      tx.get(db.collection('refreshTokens').where('userId', '==', id)),
      tx.get(setupTokens.where('userId', '==', id)),
    ]);

    tx.delete(ref);
    tx.delete(uniqueRef('email', current.email));
    if (current.phone) tx.delete(uniqueRef('phone', current.phone));
    tx.delete(codeRef('email', current.email));
    for (const doc of [...refresh.docs, ...setup.docs]) tx.delete(doc.ref);
    recordActivity(tx, {
      actorId: actor.id,
      actorName: actor.name,
      action: 'employee.deleted',
      targetType: 'user',
      targetId: id,
      targetName: current.name,
      visibility: 'feed',
    });
  });
  disconnectUser(id);
}

// Replaces any earlier link, so only the newest email works.
export async function resendInvite(actor: AuthUser, id: string): Promise<InviteResult> {
  const ref = users.doc(id);
  const { raw, employee } = await db.runTransaction(async (tx) => {
    const employee = (await getEmployeeDoc(tx, ref)).data()!;
    if (employee.status !== 'invited')
      throw new AppError('CONFLICT', 'Employee has already set up their account', 409);
    const old = await tx.get(setupTokens.where('userId', '==', id));

    for (const doc of old.docs) tx.delete(doc.ref);
    recordActivity(tx, {
      actorId: actor.id,
      actorName: actor.name,
      action: 'employee.invite_resent',
      targetType: 'user',
      targetId: id,
      targetName: employee.name,
      visibility: 'audit',
    });
    return { raw: issueSetupToken(tx, id), employee };
  });
  return sendInvite({ id, name: employee.name, email: employee.email }, actor.name, raw);
}
