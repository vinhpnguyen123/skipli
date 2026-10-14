import bcrypt from 'bcryptjs';
import { Timestamp, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { sendEmail } from '../lib/email.js';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import { sendSms } from '../lib/sms.js';
import type { Role } from '../middleware/auth.js';
import { logAudit } from './activity.js';
import { createAccessCode, verifyAccessCode, type Channel } from './access-code.js';
import { toPublicUser, uniqueRef, users, type PublicUser } from './users.js';

export const maskPhone = (phone: string) => `•••${phone.slice(-4)}`;
const maskEmail = (email: string) => `${email[0]}•••@${email.split('@')[1]}`;
const mask = (channel: Channel, target: string) =>
  channel === 'phone' ? maskPhone(target) : maskEmail(target);

// Owners sign in by phone, employees by email. The channel is also the user field holding the target.
async function findActiveUser(role: Role, channel: Channel, target: string) {
  const q = await users.where(channel, '==', target).where('role', '==', role).limit(1).get();
  const snap = q.docs[0];
  return snap?.data().status === 'active' ? snap : undefined;
}

const audit = (user: DocumentSnapshot, action: string, metadata: Record<string, unknown>) => {
  const name = user.data()!.name;
  void logAudit({
    actorId: user.id,
    actorName: name,
    action,
    targetType: 'user',
    targetId: user.id,
    targetName: name,
    metadata,
  });
};

async function deliverCode(channel: Channel, target: string, code: string) {
  const text = `Your Skipli code is ${code}. It expires in 5 minutes.`;
  if (channel === 'phone') return sendSms(target, text);
  return sendEmail({
    to: target,
    subject: 'Your Skipli sign-in code',
    text,
    html: `<p>${text}</p>`,
  });
}

// Same result whether or not the phone/email belongs to an active user, so the endpoint can't be used to probe
// accounts. Demo accounts (DEMO_MODE only) skip delivery and get the code back so reviewers can sign in.
export async function sendLoginCode(
  role: Role,
  channel: Channel,
  target: string,
): Promise<{ accessCode?: string }> {
  const user = await findActiveUser(role, channel, target);
  if (!user) return {};
  const code = await createAccessCode(channel, target);
  if (env.DEMO_MODE && user.data()?.demo === true) return { accessCode: code };
  try {
    await deliverCode(channel, target, code);
  } catch (err) {
    // Logged, not surfaced: a distinct error would reveal the account exists.
    console.error(`login code to ${mask(channel, target)} failed:`, (err as Error).message);
  }
  return {};
}

export async function loginWithCode(
  role: Role,
  channel: Channel,
  target: string,
  code: string,
): Promise<PublicUser> {
  const user = await findActiveUser(role, channel, target);
  if (!user) throw new AppError('INVALID_CODE', 'Incorrect or unknown code', 400);
  try {
    await verifyAccessCode(channel, target, code);
  } catch (err) {
    if (err instanceof AppError) audit(user, 'auth.otp_failed', { channel, reason: err.code });
    throw err;
  }
  audit(user, 'auth.signed_in', { method: channel === 'phone' ? 'sms' : 'email' });
  return toPublicUser(user);
}

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

// Compared against when the username doesn't exist, so a miss takes as long as a wrong password and response
// time doesn't reveal which usernames are real. (Hash of random bytes; matches nothing.)
const DUMMY_HASH = '$2b$12$9.2KUxdxCenOpe8bmXcnNOWvRaoiUKu656HQUOdk3Pa66RsAr73PG';

const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 'Incorrect username or password', 401);
const locked = (until: number) =>
  new AppError(
    'ACCOUNT_LOCKED',
    `Too many failed attempts. Try again in ${Math.ceil((until - Date.now()) / 60_000)} minutes, or sign in with an email code.`,
    423,
  );

// Counted in a transaction so parallel guesses can't slip past the limit. Returns the lock expiry when this
// failure triggers the lock.
async function recordFailure(ref: DocumentReference): Promise<number | undefined> {
  return db.runTransaction(async (tx) => {
    const failed = ((await tx.get(ref)).data()?.failedLogins ?? 0) + 1;
    if (failed < LOGIN_MAX_FAILURES) {
      tx.update(ref, { failedLogins: failed });
      return undefined;
    }
    const until = Date.now() + LOGIN_LOCK_MS;
    tx.update(ref, { failedLogins: 0, lockedUntil: Timestamp.fromMillis(until) });
    return until;
  });
}

// Wrong password, unknown username, and not-yet-set-up accounts all get the same INVALID_CREDENTIALS.
export async function loginWithPassword(username: string, password: string): Promise<PublicUser> {
  const claim = await uniqueRef('username', username).get();
  const ref = claim.exists ? users.doc(claim.data()!.userId) : undefined;
  const snap = ref && (await ref.get());
  const data = snap?.exists ? snap.data() : undefined;

  const lockedUntil = (data?.lockedUntil as Timestamp | null | undefined)?.toMillis() ?? 0;
  if (lockedUntil > Date.now()) {
    audit(snap!, 'auth.login_failed', { method: 'password', reason: 'ACCOUNT_LOCKED' });
    throw locked(lockedUntil);
  }

  const ok = await bcrypt.compare(password, data?.passwordHash ?? DUMMY_HASH);
  if (!ok || data?.status !== 'active' || data.role !== 'employee') {
    if (!data) throw invalidCredentials();
    const lockUntil = await recordFailure(ref!);
    audit(snap!, 'auth.login_failed', {
      method: 'password',
      reason: lockUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
    });
    throw lockUntil ? locked(lockUntil) : invalidCredentials();
  }

  if (data.failedLogins || data.lockedUntil)
    await ref!.update({ failedLogins: 0, lockedUntil: null });
  audit(snap!, 'auth.signed_in', { method: 'password' });
  return toPublicUser(snap!);
}
