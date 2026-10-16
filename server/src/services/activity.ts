import {
  FieldValue,
  type DocumentSnapshot,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';
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

export type Activity = ActivityEntry & {
  id: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export const activities = db.collection('activities');

const toDoc = (entry: ActivityEntry) => ({
  metadata: {},
  ...entry,
  createdAt: FieldValue.serverTimestamp(),
});

// Inside the caller's transaction, so the change and its activity commit or fail together. Returns the entry
// as clients see it, with the commit time approximated by now, for the live feed.
export function recordActivity(tx: Transaction, entry: ActivityEntry): Activity {
  const ref = activities.doc();
  tx.create(ref, toDoc(entry));
  return { metadata: {}, ...entry, id: ref.id, createdAt: new Date().toISOString() };
}

// Standalone write for events that change no other data (failed logins, sign-ins). Never throws:
// a missed audit row must not turn a login into a 500.
export async function logAudit(entry: Omit<ActivityEntry, 'visibility'>): Promise<void> {
  try {
    await activities.add(toDoc({ ...entry, visibility: 'audit' }));
  } catch (err) {
    console.error(`audit write failed for ${entry.action}:`, (err as Error).message);
  }
}

const toActivity = (d: DocumentSnapshot): Activity => {
  const { createdAt, ...rest } = d.data()!;
  return {
    ...(rest as ActivityEntry & { metadata: Record<string, unknown> }),
    id: d.id,
    createdAt: createdAt.toDate().toISOString(),
  };
};

// Newest first. The cursor is the id of the last entry of the previous page; an unknown id starts over.
export async function listActivities(opts: {
  visibility?: 'feed' | 'audit';
  cursor?: string;
  limit: number;
}): Promise<{ activities: Activity[]; nextCursor: string | null }> {
  let q: Query = activities;
  if (opts.visibility) q = q.where('visibility', '==', opts.visibility);
  q = q.orderBy('createdAt', 'desc').limit(opts.limit);
  if (opts.cursor) {
    const after = await activities.doc(opts.cursor).get();
    if (after.exists) q = q.startAfter(after);
  }
  const snap = await q.get();
  return {
    activities: snap.docs.map(toActivity),
    nextCursor: snap.size === opts.limit ? snap.docs[snap.size - 1].id : null,
  };
}
