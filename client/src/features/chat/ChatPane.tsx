import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { button, input } from '../../components/ui';
import type { Participant, User } from '../../lib/types';
import {
  discardOutgoing,
  otherIdOf,
  sendMessage,
  useConversations,
  useDirectory,
  useMarkRead,
  useMessages,
  useOutbox,
  useWindowFocused,
} from './hooks';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const MAX = 2000;

export function ChatPane({ me, id }: { me: User; id: string }) {
  const conversations = useConversations();
  const conv = conversations.data?.find((c) => c.id === id);
  // No conversation yet (picked from New chat, or a link): who it's with comes from the directory.
  const directory = useDirectory(conversations.isSuccess && !conv);
  const otherId = otherIdOf(id, me.id);
  const person = directory.data?.find((p) => p.id === otherId);
  const other: Participant | undefined = conv?.other ?? (person && { ...person, active: true });

  const messages = useMessages(id);
  const outbox = useOutbox(id);
  const markRead = useMarkRead();
  const focused = useWindowFocused();
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);

  const unread = conv?.unread ?? 0;
  useEffect(() => {
    if (focused && unread > 0) markRead.mutate(id);
  }, [focused, unread, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load older messages when the top of the thread scrolls into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages;
  useEffect(() => {
    const el = top.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && void fetchNextPage(), {
      root: scroller.current,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, messages.data?.pages.length]);

  const stored = messages.data?.pages.toReversed().flatMap((p) => p.messages) ?? [];
  const storedIds = new Set(stored.map((m) => m.id));
  const pending = outbox.filter((m) => !storedIds.has(m.id));
  const lastMine = stored.findLast((m) => m.senderId === me.id);
  const seen = !!lastMine && !!conv?.otherLastReadAt && conv.otherLastReadAt >= lastMine.createdAt;

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    void sendMessage(me.id, id, crypto.randomUUID(), body);
    scroller.current?.scrollTo({ top: 0 }); // column-reverse: 0 is the bottom
  };

  if (!other) {
    return (
      <p className="m-auto p-6 text-sm text-slate-500">
        {conversations.isError || directory.isError
          ? "Couldn't load this chat."
          : conversations.isPending || directory.isPending
            ? 'Loading…'
            : 'Conversation not found.'}
      </p>
    );
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <Link to="/chat" className="text-sm text-slate-500 md:hidden" aria-label="Back to chats">
          ←
        </Link>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{other.name}</h2>
          <p className="truncate text-xs text-slate-500">
            {other.role === 'owner' ? 'Manager' : other.title || 'Employee'}
          </p>
        </div>
      </header>

      {/* column-reverse keeps the view pinned to the newest message, and loading older ones above doesn't
          move what you're reading. The single child keeps messages in reading order. */}
      <div ref={scroller} className="flex flex-1 flex-col-reverse overflow-y-auto px-4 py-3">
        <div>
          <div ref={top} className="py-2 text-center text-xs text-slate-400">
            {messages.isPending ? (
              'Loading…'
            ) : messages.isError ? (
              <button className={button.link} onClick={() => void messages.refetch()}>
                Couldn't load messages. Retry
              </button>
            ) : isFetchingNextPage ? (
              'Loading older messages…'
            ) : (
              !hasNextPage &&
              (stored.length || pending.length
                ? 'Start of conversation'
                : `Say hi to ${other.name}`)
            )}
          </div>
          <ol className="space-y-1.5">
            {stored.map((m) => (
              <Bubble key={m.id} mine={m.senderId === me.id} text={m.text}>
                <span title={new Date(m.createdAt).toLocaleString()}>{time(m.createdAt)}</span>
                {m === lastMine && <span> · {seen ? 'Seen' : 'Sent'}</span>}
              </Bubble>
            ))}
            {pending.map((m) => (
              <Bubble key={m.id} mine text={m.text} failed={m.status === 'failed'}>
                {m.status === 'pending' ? (
                  'Sending…'
                ) : (
                  <span className="text-red-600">
                    {m.error} ·{' '}
                    <button
                      className="font-medium underline"
                      onClick={() => void sendMessage(me.id, id, m.id, m.text)}
                    >
                      Retry
                    </button>{' '}
                    ·{' '}
                    <button className="underline" onClick={() => discardOutgoing(id, m.id)}>
                      Discard
                    </button>
                  </span>
                )}
              </Bubble>
            ))}
          </ol>
        </div>
      </div>

      {other.active ? (
        <form
          className="flex items-end gap-2 border-t border-slate-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Message {other.name}
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message…"
            className={`${input} mt-0 max-h-32 resize-none`}
          />
          <button type="submit" disabled={!text.trim()} className={button.primary}>
            Send
          </button>
        </form>
      ) : (
        <p className="border-t border-slate-200 p-3 text-center text-sm text-slate-500">
          {other.name} is no longer active. You can read this chat but not reply.
        </p>
      )}
    </>
  );
}

function Bubble({
  mine,
  text,
  failed,
  children,
}: {
  mine: boolean;
  text: string;
  failed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <p
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
          mine ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'
        } ${failed ? 'opacity-60' : ''}`}
      >
        {text}
      </p>
      <span className="mt-0.5 px-1 text-[11px] text-slate-400">{children}</span>
    </li>
  );
}
