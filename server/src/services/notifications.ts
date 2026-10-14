import { Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { escapeHtml, sendEmail } from '../lib/email.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';
import { isOnline } from '../socket/index.js';
import { mutate, type Emit } from './mutate.js';
import { getUser } from './users.js';

export const notifications = db.collection('notifications');

export type NotificationType = 'task.assigned' | 'task.due_soon' | 'task.overdue';
export type NotificationPayload = {
  taskId: string;
  title: string;
  by?: string;
  dueDate?: string | null;
};

export type Notification = {
  id: string;
  type: NotificationType;
  payload: NotificationPayload;
  read: boolean;
  createdAt: string;
};

const toNotification = (id: string, d: DocumentData): Notification => ({
  id,
  type: d.type,
  payload: d.payload,
  read: d.read,
  createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
});

// Inside a mutate() transaction, so the notification exists only if the change it's about commits.
// Returns the socket event for mutate() to send after the commit.
export function addNotification(
  tx: Transaction,
  userId: string,
  type: NotificationType,
  payload: NotificationPayload,
): Emit {
  const ref = notifications.doc();
  const data = { userId, type, payload, read: false, createdAt: Timestamp.now() };
  tx.create(ref, data);
  return { to: [`user:${userId}`], event: 'notification:new', data: toNotification(ref.id, data) };
}

// Emails have no viewer locale, so dates are shown in the business's time zone, named so nobody guesses.
// (dateStyle/timeStyle can't be combined with timeZoneName, hence the individual fields.)
export const formatDue = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: env.BUSINESS_TZ,
    timeZoneName: 'short',
  }).format(new Date(iso));

const LIST_LIMIT = 30;

// ponytail: reads all of a user's notifications and sorts in memory (no composite index to deploy); a handful
// per task. Add a (userId, createdAt desc) index and a limit query once anyone has thousands.
export async function listNotifications(user: AuthUser) {
  const snap = await notifications.where('userId', '==', user.id).get();
  const all = snap.docs
    .map((d) => toNotification(d.id, d.data()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    notifications: all.slice(0, LIST_LIMIT),
    unreadCount: all.filter((n) => !n.read).length,
  };
}

// Marks the user's own notifications read (ids that aren't theirs are ignored), and tells their other tabs.
export async function markRead(user: AuthUser, ids: string[] | 'all'): Promise<{ ids: string[] }> {
  return mutate(async (tx) => {
    const unread = await tx.get(
      notifications.where('userId', '==', user.id).where('read', '==', false),
    );
    const targets = ids === 'all' ? unread.docs : unread.docs.filter((d) => ids.includes(d.id));
    for (const doc of targets) tx.update(doc.ref, { read: true });
    const marked = targets.map((d) => d.id);
    return {
      result: { ids: marked },
      emit: marked.length
        ? [{ to: [`user:${user.id}`], event: 'notification:read', data: { ids: marked } }]
        : [],
    };
  });
}

// After the commit: someone with no open tab would otherwise miss it, so they get an email instead.
// Never throws, sync or async: callers fire and forget, the change is already saved, and an escaping error
// would either fail a request that succeeded or become an unhandled rejection. The message is built inside
// the try for the same reason.
// ponytail: best effort, at most once. A failed send (Resend down) or a crash right after the commit loses the
// email; it is not retried, but the in-app notification it copies is already saved. For guaranteed delivery,
// write an email "outbox" doc in the same transaction and have a job send and mark those, with retries.
export async function emailIfOffline(
  userId: string,
  subject: string,
  buildLines: () => string[],
): Promise<void> {
  try {
    if (await isOnline(userId)) return;
    const lines = buildLines();
    const email = (await getUser(userId))?.data()?.email;
    if (!email) return;
    const text = [...lines, '', `Open your board: ${env.APP_URL}`].join('\n');
    const html = `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}<p><a href="${env.APP_URL}">Open your board</a></p>`;
    await sendEmail({ to: email, subject, text, html });
  } catch (err) {
    console.error(`notification email to user ${userId} failed:`, (err as Error).message);
  }
}
