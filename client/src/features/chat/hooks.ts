import { useInfiniteQuery, useMutation, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { api, post } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import type { Conversation, Message, Person } from '../../lib/types';

const LIST = ['conversations'];
type Page = { messages: Message[]; hasMore: boolean };
type Pages = InfiniteData<Page, string>;

export const conversationIdFor = (a: string, b: string) => [a, b].sort().join('_');
export const otherIdOf = (conversationId: string, me: string) =>
  conversationId.split('_').find((p) => p !== me)!;

export function useConversations() {
  return useQuery({
    queryKey: LIST,
    queryFn: () =>
      api<{ conversations: Conversation[] }>('/conversations').then((r) => r.conversations),
  });
}

export function useDirectory(enabled = true) {
  return useQuery({
    queryKey: ['directory'],
    queryFn: () => api<{ people: Person[] }>('/directory').then((r) => r.people),
    enabled,
  });
}

// Pages go newest → oldest; each page's messages are oldest-first. `before` is the oldest message id loaded.
export function useMessages(id: string) {
  return useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) =>
      api<Page>(`/conversations/${id}/messages${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.id : undefined),
  });
}

const updateConversation = (id: string, fn: (c: Conversation) => Conversation) =>
  queryClient.setQueryData<Conversation[]>(LIST, (list) =>
    list?.map((c) => (c.id === id ? fn(c) : c)),
  );

// ---- Outbox: messages this tab is sending or failed to send. Kept outside the query cache so a refetch
// (reconnect catch-up) can't wipe them; dropped once the server copy shows up.
export type Outgoing = { id: string; text: string; status: 'pending' | 'failed'; error?: string };
let outbox: Record<string, Outgoing[]> = {};
const listeners = new Set<() => void>();
const NONE: Outgoing[] = [];

function setOutbox(conversationId: string, fn: (list: Outgoing[]) => Outgoing[]) {
  outbox = { ...outbox, [conversationId]: fn(outbox[conversationId] ?? NONE) };
  listeners.forEach((l) => l());
}
export const clearOutbox = () => {
  outbox = {};
  listeners.forEach((l) => l());
};
export const discardOutgoing = (conversationId: string, id: string) =>
  setOutbox(conversationId, (l) => l.filter((m) => m.id !== id));

export function useOutbox(conversationId: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => outbox[conversationId] ?? NONE,
  );
}

// A message the server has stored, from the send ack or `message:new` (either may come first; both are
// idempotent by id). Updates the open thread, the list preview and, for incoming messages, the unread count.
function applyMessage(me: string, conversationId: string, message: Message, fromEvent: boolean) {
  discardOutgoing(conversationId, message.id);
  queryClient.setQueryData<Pages>(['messages', conversationId], (d) => {
    if (!d || d.pages.some((p) => p.messages.some((m) => m.id === message.id))) return d;
    const [newest, ...older] = d.pages;
    return { ...d, pages: [{ ...newest, messages: [...newest.messages, message] }, ...older] };
  });

  const list = queryClient.getQueryData<Conversation[]>(LIST);
  if (list && !list.some((c) => c.id === conversationId)) {
    void queryClient.invalidateQueries({ queryKey: LIST }); // first message of a new chat: fetch who it's with
    return;
  }
  queryClient.setQueryData<Conversation[]>(LIST, (l) =>
    l
      ?.map((c) =>
        c.id !== conversationId || (c.lastMessageAt ?? '') > message.createdAt
          ? c
          : {
              ...c,
              lastMessage: message.text.slice(0, 140),
              lastMessageAt: message.createdAt,
              lastSenderId: message.senderId,
              unread: fromEvent && message.senderId !== me ? c.unread + 1 : c.unread,
            },
      )
      .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
  );
}

type SendAck = { ok: true; message: Message } | { ok: false; error: { message: string } };

// New send or Retry: the same id both times, so the server stores it once even if the first try got through.
export async function sendMessage(me: string, conversationId: string, id: string, text: string) {
  setOutbox(conversationId, (l) =>
    l.some((m) => m.id === id)
      ? l.map((m) => (m.id === id ? { id, text, status: 'pending' } : m))
      : [...l, { id, text, status: 'pending' }],
  );
  const fail = (error: string) =>
    setOutbox(conversationId, (l) =>
      l.map((m) => (m.id === id ? { ...m, status: 'failed', error } : m)),
    );
  try {
    const res: SendAck = await socket
      .timeout(10_000)
      .emitWithAck('message:send', { conversationId, clientMessageId: id, text });
    if (res.ok) applyMessage(me, conversationId, res.message, false);
    else fail(res.error.message);
  } catch {
    fail("Couldn't reach the server");
  }
}

// Optimistic: the badge clears now; the server's conversation:read confirms it (and clears other tabs).
export function useMarkRead() {
  return useMutation({
    mutationFn: (id: string) => post(`/conversations/${id}/read`),
    onMutate: (id) => updateConversation(id, (c) => ({ ...c, unread: 0 })),
    onError: () => queryClient.invalidateQueries({ queryKey: LIST }),
  });
}

// Mounted once in the app shell, so badges stay live on every page. A reconnect refetches the list and every
// loaded thread (messages missed while offline); pending sends live in the outbox and survive that.
export function useChatEvents(me: string) {
  useEffect(() => {
    const added = ({ conversationId, message }: { conversationId: string; message: Message }) =>
      applyMessage(me, conversationId, message, true);
    const read = (e: { conversationId: string; userId: string; lastReadAt: string }) =>
      updateConversation(e.conversationId, (c) =>
        e.userId === me ? { ...c, unread: 0 } : { ...c, otherLastReadAt: e.lastReadAt },
      );
    const reload = () => {
      void queryClient.invalidateQueries({ queryKey: LIST });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
    };
    socket.on('message:new', added).on('conversation:read', read).on('connect', reload);
    return () => {
      socket.off('message:new', added).off('conversation:read', read).off('connect', reload);
    };
  }, [me]);
}

// True while this window has focus (hidden tabs never do), so messages are only marked read when seen.
export function useWindowFocused() {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('focus', l);
      window.addEventListener('blur', l);
      document.addEventListener('visibilitychange', l);
      return () => {
        window.removeEventListener('focus', l);
        window.removeEventListener('blur', l);
        document.removeEventListener('visibilitychange', l);
      };
    },
    () => document.hasFocus() && document.visibilityState === 'visible',
  );
}
