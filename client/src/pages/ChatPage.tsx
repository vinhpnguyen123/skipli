import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { button, input } from '../components/ui';
import { ChatPane } from '../features/chat/ChatPane';
import { conversationIdFor, useConversations, useDirectory } from '../features/chat/hooks';
import { PresenceDot } from '../features/chat/PresenceDot';
import type { User } from '../lib/types';

const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// List + thread side by side; on phones one at a time (the thread when a chat is open).
export default function ChatPage({ user }: { user: User }) {
  const { id } = useParams();
  const [picking, setPicking] = useState(false);

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-96 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <aside
        className={`${id ? 'hidden md:flex' : 'flex'} w-full flex-col border-slate-200 md:w-80 md:border-r`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-900">{picking ? 'New chat' : 'Chats'}</h1>
          <button onClick={() => setPicking(!picking)} className={`${button.link} text-xs`}>
            {picking ? 'Cancel' : 'New chat'}
          </button>
        </div>
        {picking ? (
          <Picker me={user.id} onPick={() => setPicking(false)} />
        ) : (
          <ConversationList me={user.id} onNew={() => setPicking(true)} />
        )}
      </aside>
      <section className={`${id ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {id ? (
          <ChatPane key={id} me={user} id={id} />
        ) : (
          <p className="m-auto text-sm text-slate-500">Pick a chat or start a new one.</p>
        )}
      </section>
    </div>
  );
}

function ConversationList({ me, onNew }: { me: string; onNew: () => void }) {
  const conversations = useConversations();
  const list = conversations.data ?? [];

  if (conversations.isPending) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (conversations.isError)
    return (
      <p className="p-4 text-sm text-red-600">
        Couldn't load chats.{' '}
        <button className={button.link} onClick={() => void conversations.refetch()}>
          Retry
        </button>
      </p>
    );
  if (!list.length)
    return (
      <div className="p-6 text-center text-sm text-slate-500">
        <p>No chats yet.</p>
        <button className={`${button.secondary} mt-3`} onClick={onNew}>
          Start a chat
        </button>
      </div>
    );

  return (
    <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
      {list.map((c) => (
        <li key={c.id}>
          <NavLink
            to={`/chat/${c.id}`}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 hover:bg-slate-50 ${isActive ? 'bg-slate-100' : ''}`
            }
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`truncate text-sm ${c.unread ? 'font-semibold text-slate-900' : 'text-slate-800'} ${c.other.active ? '' : 'italic'}`}
                  >
                    {c.other.name}
                  </span>
                  {c.other.active && <PresenceDot userId={c.other.id} />}
                </span>
                {c.lastMessageAt && (
                  <span className="shrink-0 text-xs text-slate-400">{when(c.lastMessageAt)}</span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-xs ${c.unread ? 'text-slate-900' : 'text-slate-500'}`}
                >
                  {c.lastSenderId === me && 'You: '}
                  {c.lastMessage}
                </span>
                {c.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold leading-4 text-white">
                    {c.unread > 99 ? '99+' : c.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </span>
            </span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function Picker({ me, onPick }: { me: string; onPick: () => void }) {
  const directory = useDirectory();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const people = (directory.data ?? []).filter((p) =>
    [p.name, p.title, p.department].some((f) => f.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <label htmlFor="chat-search" className="sr-only">
          Search people
        </label>
        <input
          id="chat-search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, title or department"
          className={`${input} mt-0`}
        />
      </div>
      {directory.isPending ? (
        <p className="p-4 text-sm text-slate-500">Loading…</p>
      ) : directory.isError ? (
        <p className="p-4 text-sm text-red-600">Couldn't load people.</p>
      ) : !people.length ? (
        <p className="p-4 text-sm text-slate-500">{q ? 'No one matches.' : 'No coworkers yet.'}</p>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {people.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onPick();
                  navigate(`/chat/${conversationIdFor(me, p.id)}`);
                }}
                className="block w-full px-4 py-2.5 text-left hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 text-sm text-slate-900">
                  {p.name}
                  <PresenceDot userId={p.id} />
                </span>
                <span className="block text-xs text-slate-500">
                  {p.role === 'owner'
                    ? 'Manager'
                    : [p.title, p.department].filter(Boolean).join(' · ') || 'Employee'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
