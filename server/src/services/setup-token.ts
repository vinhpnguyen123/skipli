import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { db } from '../lib/firebase.js';

export const SETUP_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

export const setupTokens = db.collection('setupTokens');
export const hashSetupToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
export const setupUrl = (raw: string) => `${env.APP_URL}/setup?token=${raw}`;

// Inside the caller's transaction. Returns the raw token for the email link; only its hash is stored,
// so a leaked database can't be used to finish someone's setup.
export function issueSetupToken(tx: Transaction, userId: string): string {
  const raw = randomBytes(32).toString('base64url');
  tx.create(setupTokens.doc(hashSetupToken(raw)), {
    userId,
    expiresAt: Timestamp.fromMillis(Date.now() + SETUP_TOKEN_TTL_MS),
    usedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return raw;
}
