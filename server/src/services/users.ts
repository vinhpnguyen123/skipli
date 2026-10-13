import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { Role } from '../middleware/auth.js';

export const users = db.collection('users');

// What the client gets back; never includes passwordHash or lockout fields.
export type PublicUser = {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string | null;
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
    phone: d.phone ?? null,
    department: d.department,
    title: d.title ?? '',
    status: d.status,
  };
}

export async function getUser(id: string): Promise<DocumentSnapshot | undefined> {
  const snap = await users.doc(id).get();
  return snap.exists ? snap : undefined;
}

// For requests carrying a valid token: the account must still exist and be active. A deleted or
// disabled user's access token is refused right away instead of working until it expires.
export async function getActiveUser(id: string): Promise<DocumentSnapshot> {
  const snap = await getUser(id);
  if (snap?.data()?.status !== 'active') {
    throw new AppError('UNAUTHENTICATED', 'Account unavailable', 401);
  }
  return snap;
}
