import { Link } from 'react-router-dom';
import { button } from '../../components/ui';
import { ago } from '../../lib/time';
import { describe, useActivities } from './hooks';

// Shared by the dashboard widget (latest few, live) and the audit log page (everything, paged).
export function ActivityList({
  visibility,
  limit,
  paged = false,
}: {
  visibility: 'feed' | 'audit' | 'all';
  limit: number;
  paged?: boolean;
}) {
  const q = useActivities(visibility, limit);
  if (q.isPending) return <p className="p-4 text-sm text-slate-500">Loading activity…</p>;
  if (q.isError)
    return (
      <div className="p-4 text-sm">
        <p className="text-red-600">Couldn't load activity: {q.error.message}</p>
        <button onClick={() => q.refetch()} className={`${button.link} mt-2`}>
          Try again
        </button>
      </div>
    );
  const items = q.data.pages.flatMap((p) => p.activities);
  if (!items.length) return <p className="p-4 text-sm text-slate-500">Nothing has happened yet.</p>;

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {(paged ? items : items.slice(0, limit)).map((a) => (
          <li key={a.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
            <p className="min-w-0 flex-1 text-slate-700">
              <span className="font-medium text-slate-900">{a.actorName}</span> {describe(a)}
              {a.targetType === 'task' && a.action !== 'task.deleted' && (
                <Link
                  to={`/?task=${a.targetId}`}
                  className="ml-2 text-xs text-blue-600 hover:underline"
                >
                  Open
                </Link>
              )}
            </p>
            {a.visibility === 'audit' && visibility === 'all' && (
              <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium uppercase text-slate-500">
                audit
              </span>
            )}
            <time
              dateTime={a.createdAt}
              title={new Date(a.createdAt).toLocaleString()}
              className="shrink-0 text-xs text-slate-500"
            >
              {ago(a.createdAt)}
            </time>
          </li>
        ))}
      </ul>
      {paged && q.hasNextPage && (
        <div className="border-t border-slate-100 p-3 text-center">
          <button
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className={button.link}
          >
            {q.isFetchingNextPage ? 'Loading…' : 'Load older'}
          </button>
        </div>
      )}
    </>
  );
}
