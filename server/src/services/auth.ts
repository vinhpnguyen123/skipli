import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import { sendSms } from '../lib/sms.js';
import type { Role } from '../middleware/auth.js';
import { logAudit } from './activity.js';
import { createAccessCode, verifyAccessCode } from './access-code.js';

// What the client gets back; never includes passwordHash or lockout fields.
export type PublicUser = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string;
  department: string;
  title: string;
  status: 'invited' | 'active' | 'disabled';
};

export function toPublicUser(snap: DocumentSnapshot): PublicUser {
  const d = snap.data()!;
  return {
    id: snap.id,
    role: d.role,
    name: d.name,
    email: d.email,
    phone: d.phone,
    department: d.department,
    title: d.title,
    status: d.status,
  };
}

export const maskPhone = (phone: string) => `•••${phone.slice(-4)}`;

export async function getUser(id: string): Promise<DocumentSnapshot | undefined> {
  const snap = await db.collection('users').doc(id).get();
  return snap.exists ? snap : undefined;
}

async function findActiveOwner(phone: string): Promise<DocumentSnapshot | undefined> {
  const q = await db
    .collection('users')
    .where('phone', '==', phone)
    .where('role', '==', 'owner')
    .limit(1)
    .get();
  const snap = q.docs[0];
  return snap?.data().status === 'active' ? snap : undefined;
}

// Same result whether or not the number belongs to an owner, so the endpoint can't be used to probe numbers.
// Demo accounts (DEMO_MODE only) skip SMS and get the code back so reviewers can sign in.
export async function sendOwnerCode(phone: string): Promise<{ accessCode?: string }> {
  const owner = await findActiveOwner(phone);
  if (!owner) return {};
  const code = await createAccessCode('phone', phone);
  if (env.DEMO_MODE && owner.data()?.demo === true) return { accessCode: code };
  try {
    await sendSms(phone, `Your Skipli code is ${code}. It expires in 5 minutes.`);
  } catch (err) {
    // Logged, not surfaced: a distinct error would reveal the number is an owner's.
    console.error(`sms to ${maskPhone(phone)} failed:`, (err as Error).message);
  }
  return {};
}

export async function loginOwnerWithCode(phone: string, code: string): Promise<PublicUser> {
  const owner = await findActiveOwner(phone);
  if (!owner) throw new AppError('INVALID_CODE', 'Incorrect or unknown code', 400);
  const who = {
    actorId: owner.id,
    actorName: owner.data()!.name,
    targetType: 'user',
    targetId: owner.id,
  };

  try {
    await verifyAccessCode('phone', phone, code);
  } catch (err) {
    if (err instanceof AppError) {
      void logAudit({
        ...who,
        targetName: who.actorName,
        action: 'auth.otp_failed',
        metadata: { reason: err.code },
      });
    }
    throw err;
  }
  void logAudit({
    ...who,
    targetName: who.actorName,
    action: 'auth.signed_in',
    metadata: { method: 'sms' },
  });
  return toPublicUser(owner);
}
