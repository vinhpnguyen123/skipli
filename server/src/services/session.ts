import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const tokens = db.collection('refreshTokens');
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export const signAccessToken = (user: AuthUser) =>
  jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    algorithm: 'HS256',
  });

const newRefreshDoc = (userId: string, familyId: string) => ({
  userId,
  familyId,
  expiresAt: Timestamp.fromMillis(Date.now() + REFRESH_TOKEN_TTL_MS),
  revokedAt: null,
  replacedBy: null,
  createdAt: FieldValue.serverTimestamp(),
});

// Starts a new family (one per login). Returns the raw token for the cookie; only its hash is stored.
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await tokens.doc(hash(raw)).create(newRefreshDoc(userId, randomUUID()));
  return raw;
}

type Rotation = { ok: true; userId: string; raw: string } | { ok: false; reused: boolean };

// Swap a refresh token for a new one in the same family. Presenting a token that was already rotated
// or revoked means it leaked (or a replay): revoke the whole family so both copies stop working.
// ponytail: two tabs refreshing at the same instant look like reuse and sign the user out; the client
// shares one in-flight refresh per tab. Add a short grace window if multi-tab logouts show up.
export async function rotateRefreshToken(raw: string): Promise<{ userId: string; raw: string }> {
  const ref = tokens.doc(hash(raw));
  const result = await db.runTransaction<Rotation>(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data) return { ok: false, reused: false };
    if (data.revokedAt || data.replacedBy) {
      const family = await tx.get(
        tokens.where('familyId', '==', data.familyId).where('revokedAt', '==', null),
      );
      for (const doc of family.docs)
        tx.update(doc.ref, { revokedAt: FieldValue.serverTimestamp() });
      return { ok: false, reused: true };
    }
    if ((data.expiresAt as Timestamp).toMillis() <= Date.now()) return { ok: false, reused: false };

    const next = randomBytes(32).toString('base64url');
    tx.create(tokens.doc(hash(next)), newRefreshDoc(data.userId, data.familyId));
    tx.update(ref, { replacedBy: hash(next), revokedAt: FieldValue.serverTimestamp() });
    return { ok: true, userId: data.userId, raw: next };
  });

  if (!result.ok) {
    if (result.reused) console.warn('refresh token reuse detected, family revoked');
    throw new AppError('UNAUTHENTICATED', 'Session expired, sign in again', 401);
  }
  return { userId: result.userId, raw: result.raw };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await tokens
    .doc(hash(raw))
    .update({ revokedAt: FieldValue.serverTimestamp() })
    .catch(() => {}); // unknown token: nothing to revoke
}
