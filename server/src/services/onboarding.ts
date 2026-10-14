import bcrypt from 'bcryptjs';
import {
  FieldValue,
  type DocumentSnapshot,
  type Transaction,
  type Timestamp,
} from 'firebase-admin/firestore';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import { recordActivity } from './activity.js';
import { hashSetupToken, setupTokens } from './setup-token.js';
import { uniqueRef, users } from './users.js';

export const BCRYPT_COST = 12;

// One message for unknown, replaced and deleted-account links: none of them can be told apart by the visitor.
const invalidLink = () =>
  new AppError(
    'LINK_INVALID',
    'This setup link is invalid. Ask your manager to send a new invite.',
    400,
  );

// Reads the token and its user, and throws unless the link can still be used.
async function loadSetup(tx: Transaction | undefined, raw: string) {
  const ref = setupTokens.doc(hashSetupToken(raw));
  const token = tx ? await tx.get(ref) : await ref.get();
  const data = token.data();
  if (!data) throw invalidLink();
  if (data.usedAt) {
    throw new AppError('LINK_USED', 'This setup link was already used. Sign in instead.', 410);
  }
  if ((data.expiresAt as Timestamp).toMillis() <= Date.now()) {
    throw new AppError(
      'LINK_EXPIRED',
      'This setup link has expired. Ask your manager to resend the invite.',
      410,
    );
  }
  const userRef = users.doc(data.userId);
  const user: DocumentSnapshot = tx ? await tx.get(userRef) : await userRef.get();
  if (user.data()?.status !== 'invited') throw invalidLink();
  return { ref, user };
}

// For the setup page: greet the employee and show which account they're setting up.
export async function checkSetupToken(raw: string) {
  const { user } = await loadSetup(undefined, raw);
  const { name, email } = user.data()!;
  return { name, email };
}

export async function completeSetup(
  raw: string,
  username: string,
  password: string,
): Promise<{ username: string }> {
  // Hashed before the transaction: bcrypt is slow on purpose, and Firestore may retry the transaction body.
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  await db.runTransaction(async (tx) => {
    const { ref, user } = await loadSetup(tx, raw);
    if ((await tx.get(uniqueRef('username', username))).exists) {
      throw new AppError('CONFLICT', 'That username is taken', 409, [{ path: 'username' }]);
    }

    tx.update(ref, { usedAt: FieldValue.serverTimestamp() });
    tx.create(uniqueRef('username', username), { userId: user.id });
    tx.update(user.ref, {
      username,
      passwordHash,
      status: 'active',
      failedLogins: 0,
      lockedUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const name = user.data()!.name;
    recordActivity(tx, {
      actorId: user.id,
      actorName: name,
      action: 'employee.setup_completed',
      targetType: 'user',
      targetId: user.id,
      targetName: name,
      visibility: 'feed',
    });
  });
  return { username };
}
