import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';
import type { UpdateProfileInput } from '../schemas/employees.js';
import { recordActivity } from './activity.js';
import { applyUserUpdate } from './employees.js';
import { getActiveUser, getUser, toPublicUser, users, type PublicUser } from './users.js';

export async function getProfile(user: AuthUser): Promise<PublicUser> {
  return toPublicUser(await getActiveUser(user.id));
}

// The signed-in user edits their own name, email and phone. Email and phone are also sign-in identifiers
// (employee email codes, owner SMS), so a change takes effect for the next sign-in.
// ponytail: no confirmation step for a new email/phone; add a verify-before-switch flow if that's ever needed.
export async function updateProfile(
  user: AuthUser,
  patch: UpdateProfileInput,
): Promise<PublicUser> {
  const ref = users.doc(user.id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data();
    if (current?.status !== 'active')
      throw new AppError('UNAUTHENTICATED', 'Account unavailable', 401);
    // The owner signs in by SMS; without a phone they couldn't sign in again.
    if (current.role === 'owner' && patch.phone === null) {
      throw new AppError('VALIDATION_ERROR', 'Owners need a phone number to sign in', 400, [
        { in: 'body', path: 'phone', message: 'Required: you sign in with this number' },
      ]);
    }
    await applyUserUpdate(tx, ref, current, patch);
    recordActivity(tx, {
      actorId: user.id,
      actorName: patch.name ?? current.name,
      action: 'profile.updated',
      targetType: 'user',
      targetId: user.id,
      targetName: patch.name ?? current.name,
      visibility: 'feed',
      metadata: { fields: Object.keys(patch) },
    });
  });
  return toPublicUser((await getUser(user.id))!);
}
