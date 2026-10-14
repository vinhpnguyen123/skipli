import { Timestamp, type DocumentData } from 'firebase-admin/firestore';
import {
  addNotification,
  emailIfOffline,
  formatDue,
  type NotificationType,
} from './notifications.js';
import { mutate } from './mutate.js';
import { tasks } from './tasks.js';

export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

type Kind = { type: NotificationType; field: 'reminderSentAt' | 'overdueNotifiedAt' };
const DUE_SOON: Kind = { type: 'task.due_soon', field: 'reminderSentAt' };
const OVERDUE: Kind = { type: 'task.overdue', field: 'overdueNotifiedAt' };

// Which reminder an open, assigned task is owed right now, if any. Each kind is sent once; a task first seen
// already overdue gets only the overdue one. (A new due date resets both fields, see updateTask.)
function owed(d: DocumentData, now: number): Kind | null {
  if (!d.assigneeId || d.status === 'done' || !d.dueDate) return null;
  const due = (d.dueDate as Timestamp).toMillis();
  if (due < now) return d.overdueNotifiedAt ? null : OVERDUE;
  if (due - now <= DUE_SOON_MS) return d.reminderSentAt ? null : DUE_SOON;
  return null;
}

// Run hourly by the scheduler. Safe to run more often, twice at once, or after a missed hour: every send is
// a per-task transaction that re-checks the "already sent" field, so nobody gets the same reminder twice.
// The flag means the in-app reminder was saved; the email copy is best effort (see emailIfOffline) and is
// not retried by later runs.
// ponytail: one range query on dueDate (automatic single-field index) and the status check in code; add a
// (status, dueDate) composite index if open tasks with due dates ever number in the thousands.
export async function sendDueReminders(now = Date.now()) {
  const candidates = await tasks
    .where('dueDate', '<=', Timestamp.fromMillis(now + DUE_SOON_MS))
    .get();
  const sent = { dueSoon: 0, overdue: 0 };

  for (const doc of candidates.docs) {
    if (!owed(doc.data(), now)) continue; // cheap pre-check; the transaction decides
    const result = await mutate(async (tx) => {
      const d = (await tx.get(doc.ref)).data();
      const kind = d && owed(d, now);
      if (!d || !kind) return { result: null }; // changed or already sent since the query
      // Not a user-visible change, so no version bump and no task:updated event.
      tx.update(doc.ref, {
        [kind.field]: Timestamp.fromMillis(now),
        ...(kind === OVERDUE && !d.reminderSentAt && { reminderSentAt: Timestamp.fromMillis(now) }),
      });
      const payload = {
        taskId: doc.id,
        title: d.title,
        dueDate: (d.dueDate as Timestamp).toDate().toISOString(),
      };
      return {
        result: { kind, assigneeId: d.assigneeId as string, payload },
        emit: [addNotification(tx, d.assigneeId, kind.type, payload)],
      };
    });
    if (!result) continue;

    sent[result.kind === OVERDUE ? 'overdue' : 'dueSoon']++;
    const { title, dueDate } = result.payload;
    await emailIfOffline(
      result.assigneeId,
      result.kind === OVERDUE ? `Overdue: ${title}` : `Due soon: ${title}`,
      () => [
        result.kind === OVERDUE
          ? `"${title}" was due ${formatDue(dueDate)} and isn't done yet.`
          : `"${title}" is due ${formatDue(dueDate)}.`,
      ],
    );
  }
  return { checked: candidates.size, ...sent };
}
