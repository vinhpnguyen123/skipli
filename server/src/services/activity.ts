import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db } from '../lib/firebase.js';

export type ActivityEntry = {
  actorId: string;
  actorName: string;
  // noun.verb_past, e.g. task.completed, employee.deleted, auth.otp_failed
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  visibility: 'feed' | 'audit';
  metadata?: Record<string, unknown>;
};

const toDoc = (entry: ActivityEntry) => ({
  metadata: {},
  ...entry,
  createdAt: FieldValue.serverTimestamp(),
});

// Inside the caller's transaction, so the change and its activity commit or fail together.
export function recordActivity(tx: Transaction, entry: ActivityEntry): void {
  tx.create(db.collection('activities').doc(), toDoc(entry));
}

// Standalone write for events that change no other data (failed logins, sign-ins). Never throws:
// a missed audit row must not turn a login into a 500.
export async function logAudit(entry: Omit<ActivityEntry, 'visibility'>): Promise<void> {
  try {
    await db.collection('activities').add(toDoc({ ...entry, visibility: 'audit' }));
  } catch (err) {
    console.error(`audit write failed for ${entry.action}:`, (err as Error).message);
  }
}
