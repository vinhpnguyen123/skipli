import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type Channel = 'phone' | 'email';

// The channel and target are part of the MAC, so a code's hash is useless for any other target.
const hmac = (channel: Channel, target: string, code: string) =>
  createHmac('sha256', env.OTP_HMAC_SECRET).update(`${channel}:${target}:${code}`).digest('hex');

export const codeRef = (channel: Channel, target: string) =>
  db.collection('accessCodes').doc(`${channel}:${target}`);

// One live code per target: a new code replaces the old one and resets the attempt counter.
// Returns the plain code for the caller to send; only its HMAC is stored.
export async function createAccessCode(channel: Channel, target: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await codeRef(channel, target).set({
    codeHmac: hmac(channel, target, code),
    expiresAt: Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
    attempts: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  return code;
}

type Outcome = 'ok' | 'invalid' | 'expired' | 'locked';

// Read-check-write in one transaction so parallel guesses can't slip past the attempt cap.
// Errors are thrown after the transaction: throwing inside it would roll back the attempts++ write.
export async function verifyAccessCode(
  channel: Channel,
  target: string,
  code: string,
): Promise<void> {
  const ref = codeRef(channel, target);
  const outcome = await db.runTransaction<Outcome>(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data?.codeHmac) return 'invalid';
    if (data.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
    if ((data.expiresAt as Timestamp).toMillis() <= Date.now()) return 'expired';

    const expected = Buffer.from(data.codeHmac, 'hex');
    const actual = Buffer.from(hmac(channel, target, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      tx.update(ref, { attempts: FieldValue.increment(1) });
      return data.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid';
    }
    // Spec: reset the code to an empty string once it's used.
    tx.update(ref, { codeHmac: '', attempts: 0 });
    return 'ok';
  });

  if (outcome === 'invalid') throw new AppError('INVALID_CODE', 'Incorrect or unknown code', 400);
  if (outcome === 'expired')
    throw new AppError('CODE_EXPIRED', 'Code expired, request a new one', 400);
  if (outcome === 'locked')
    throw new AppError('CODE_LOCKED', 'Too many attempts, request a new code', 423);
}
