import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';
import type { SendMessageInput } from '../schemas/chat.js';
import { mutate } from './mutate.js';
import { users } from './users.js';

export const conversations = db.collection('conversations');
const messagesOf = (conversationId: string) =>
  conversations.doc(conversationId).collection('messages');

export const conversationIdFor = (a: string, b: string) => [a, b].sort().join('_');

const notFound = () => new AppError('NOT_FOUND', 'Conversation not found', 404);

// The two participants, if `id` is the canonical (sorted) id of a pair that includes the caller. Anything
// else looks like it doesn't exist, so ids of other people's conversations can't be probed.
function participantsOf(user: AuthUser, id: string): { me: string; other: string } {
  const [a, b] = id.split('_');
  if (!a || !b || a === b || id !== conversationIdFor(a, b)) throw notFound();
  if (user.id !== a && user.id !== b) throw notFound();
  return { me: user.id, other: user.id === a ? b : a };
}

const iso = (t: Timestamp | undefined | null) => t?.toDate().toISOString() ?? null;

export type Message = { id: string; senderId: string; text: string; createdAt: string };

const toMessage = (id: string, d: DocumentData): Message => ({
  id,
  senderId: d.senderId,
  text: d.text,
  createdAt: iso(d.createdAt)!,
});

// Who's on the other end. `active: false` = deleted or no longer active: the chat stays readable but closed.
export type Participant = {
  id: string;
  name: string;
  title: string;
  role: string;
  active: boolean;
};

export type Conversation = {
  id: string;
  other: Participant;
  lastMessage: string;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  unread: number; // the viewer's
  otherLastReadAt: string | null; // for "Seen" under the viewer's own messages
};

function participant(
  id: string,
  snap: DocumentSnapshot | undefined,
  nameSnapshot?: string,
): Participant {
  const d = snap?.data();
  if (!d)
    return {
      id,
      name: nameSnapshot ?? 'Former employee',
      title: '',
      role: 'employee',
      active: false,
    };
  return { id, name: d.name, title: d.title ?? '', role: d.role, active: d.status === 'active' };
}

// Coworkers anyone can start a chat with: active users other than the caller. Names and job info only;
// emails and phones stay with the owner's employee list.
export async function listDirectory(user: AuthUser) {
  const snap = await users.where('status', '==', 'active').get();
  return snap.docs
    .filter((d) => d.id !== user.id)
    .map((d) => {
      const { name, title, department, role } = d.data();
      return { id: d.id, name, title: title ?? '', department: department ?? '', role };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ponytail: all of the caller's conversations, sorted in memory (no composite index); one per coworker at most.
export async function listConversations(user: AuthUser): Promise<Conversation[]> {
  const snap = await conversations.where('participantIds', 'array-contains', user.id).get();
  const otherIds = snap.docs.map((d) =>
    (d.data().participantIds as string[]).find((p) => p !== user.id)!,
  );
  const others = otherIds.length ? await db.getAll(...otherIds.map((id) => users.doc(id))) : [];

  return snap.docs
    .map((doc, i) => {
      const d = doc.data();
      const otherId = otherIds[i];
      return {
        id: doc.id,
        other: participant(otherId, others[i].exists ? others[i] : undefined, d.names?.[otherId]),
        lastMessage: d.lastMessage ?? '',
        lastMessageAt: iso(d.lastMessageAt),
        lastSenderId: d.lastSenderId ?? null,
        unread: d.unread?.[user.id] ?? 0,
        otherLastReadAt: iso(d.lastReadAt?.[otherId]),
      };
    })
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
}

// Newest page first from Firestore, returned oldest-first for display. `before` is a message id; paging from
// its snapshot (not its timestamp) keeps two messages with the same time from being skipped or repeated.
export async function listMessages(
  user: AuthUser,
  id: string,
  before: string | undefined,
  limit: number,
) {
  participantsOf(user, id);
  let q = messagesOf(id)
    .orderBy('createdAt', 'desc')
    .limit(limit + 1);
  if (before) {
    const cursor = await messagesOf(id).doc(before).get();
    if (!cursor.exists) throw new AppError('VALIDATION_ERROR', 'Unknown cursor', 400);
    q = q.startAfter(cursor);
  }
  const docs = (await q.get()).docs;
  const page = docs.slice(0, limit).map((d) => toMessage(d.id, d.data()));
  return { messages: page.reverse(), hasMore: docs.length > limit };
}

const PREVIEW_LENGTH = 140;

// The one write that arrives over the socket (see socket/chat.ts); same mutate() path as everything else.
// Creates the conversation on the first message. Sending the same clientMessageId again returns the stored
// message without changing anything, so a retry after a lost ack is safe.
export async function sendMessage(user: AuthUser, input: SendMessageInput): Promise<Message> {
  const { me, other } = participantsOf(user, input.conversationId);
  const convRef = conversations.doc(input.conversationId);
  const msgRef = messagesOf(input.conversationId).doc(input.clientMessageId);

  return mutate(async (tx) => {
    const [existing, sender, recipient] = await tx.getAll(msgRef, users.doc(me), users.doc(other));
    if (existing.exists) {
      // Someone else's message under this id: not a retry of ours.
      if (existing.data()!.senderId !== me)
        throw new AppError('CONFLICT', 'Message id already used', 409);
      return { result: toMessage(existing.id, existing.data()!) };
    }
    if (sender.data()?.status !== 'active')
      throw new AppError('UNAUTHENTICATED', 'Account unavailable', 401);
    if (recipient.data()?.status !== 'active') {
      throw new AppError(
        'CONVERSATION_CLOSED',
        `${recipient.data()?.name ?? 'This person'} can't receive messages`,
        409,
      );
    }

    const now = Timestamp.now();
    const data = { senderId: me, text: input.text, createdAt: now };
    tx.create(msgRef, data);
    tx.set(
      convRef,
      {
        participantIds: [me, other].sort(),
        // Name snapshots, so the chat still shows who it was with after someone is deleted.
        names: { [me]: sender.data()!.name, [other]: recipient.data()!.name },
        lastMessage: input.text.slice(0, PREVIEW_LENGTH),
        lastMessageAt: now,
        lastSenderId: me,
        unread: { [other]: FieldValue.increment(1) },
        lastReadAt: { [me]: now }, // you've read everything up to your own message
      },
      { merge: true },
    );
    const message = toMessage(msgRef.id, data);
    return {
      result: message,
      emit: [
        {
          to: [`user:${me}`, `user:${other}`],
          event: 'message:new',
          data: { conversationId: input.conversationId, message },
        },
      ],
    };
  });
}

// Clears the caller's unread count and records how far they've read. Both participants hear about it: the
// other side shows "Seen", the caller's other tabs clear their badge.
export async function markRead(user: AuthUser, id: string): Promise<{ lastReadAt: string | null }> {
  const { me, other } = participantsOf(user, id);
  const ref = conversations.doc(id);
  return mutate<{ lastReadAt: string | null }>(async (tx) => {
    if (!(await tx.get(ref)).exists) return { result: { lastReadAt: null } }; // nothing sent yet
    const now = Timestamp.now();
    tx.set(ref, { unread: { [me]: 0 }, lastReadAt: { [me]: now } }, { merge: true });
    const lastReadAt = now.toDate().toISOString();
    return {
      result: { lastReadAt },
      emit: [
        {
          to: [`user:${me}`, `user:${other}`],
          event: 'conversation:read',
          data: { conversationId: id, userId: me, lastReadAt },
        },
      ],
    };
  });
}
