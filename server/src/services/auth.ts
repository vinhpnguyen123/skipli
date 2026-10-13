import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { sendSms } from '../lib/sms.js';
import { logAudit } from './activity.js';
import { createAccessCode, verifyAccessCode } from './access-code.js';
import { toPublicUser, users, type PublicUser } from './users.js';

export const maskPhone = (phone: string) => `•••${phone.slice(-4)}`;

async function findActiveOwner(phone: string): Promise<DocumentSnapshot | undefined> {
  const q = await users.where('phone', '==', phone).where('role', '==', 'owner').limit(1).get();
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
