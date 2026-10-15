import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { button } from '../../components/ui';
import { ago } from '../../lib/time';
import type { AppNotification } from '../../lib/types';
import { useMarkRead, useNotificationEvents, useNotifications } from './hooks';

const TEXT: Record<AppNotification['type'], (n: AppNotification) => string> = {
  'task.assigned': (n) => `${n.payload.by ?? 'Your manager'} assigned you “${n.payload.title}”`,
  'task.due_soon': (n) => `“${n.payload.title}” is due soon`,
  'task.overdue': (n) => `“${n.payload.title}” is overdue`,
};

// Native popover: outside clicks and Escape close it, and it renders above everything without a portal.
export function NotificationBell() {
  const data = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  useNotificationEvents();

  const unread = data.data?.unreadCount ?? 0;
  const list = data.data?.notifications ?? [];

  const open = (n: AppNotification) => {
    if (!n.read) markRead.mutate([n.id]);
    panel.current?.hidePopover();
    navigate(`/?task=${n.payload.taskId}`); // the board opens that task
  };

  return (
    <>
      <button
        popoverTarget="notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <path
            d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <div
        id="notifications"
        ref={panel}
        popover="auto"
        className="fixed inset-auto right-4 top-14 m-0 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-white p-0 shadow-xl ring-1 ring-slate-200"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
          {unread > 0 && (
            <button onClick={() => markRead.mutate('all')} className={`${button.link} text-xs`}>
              Mark all read
            </button>
          )}
        </div>
        {data.isPending ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : data.isError ? (
          <p className="p-4 text-sm text-red-600">Couldn't load notifications.</p>
        ) : list.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">You're all caught up.</p>
        ) : (
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {list.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-blue-50/50'}`}
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-blue-600'}`}
                  />
                  <span>
                    <span
                      className={`block text-sm ${n.read ? 'text-slate-600' : 'font-medium text-slate-900'}`}
                    >
                      {TEXT[n.type](n)}
                    </span>
                    <span className="text-xs text-slate-500">{ago(n.createdAt)}</span>
                    {!n.read && <span className="sr-only"> (unread)</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
