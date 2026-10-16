import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import type { Activity } from '../../lib/types';

type Page = { activities: Activity[]; nextCursor: string | null };
type Visibility = 'feed' | 'audit' | 'all';

const key = (visibility: Visibility) => ['activities', visibility];

// Owner only. Newest first, a page at a time.
export function useActivities(visibility: Visibility, limit = 30) {
  return useInfiniteQuery({
    queryKey: [...key(visibility), limit],
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(limit) });
      if (visibility !== 'all') q.set('visibility', visibility);
      if (pageParam) q.set('cursor', pageParam);
      return api<Page>(`/activities?${q}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// Feed entries arrive live (owner room); they go on top of the first page of every list showing them.
// A reconnect reloads.
export function useActivityEvents() {
  useEffect(() => {
    const added = (a: Activity) => {
      for (const v of ['feed', 'all'] as const)
        queryClient.setQueriesData<{ pages: Page[]; pageParams: string[] }>(
          { queryKey: key(v) },
          (d) =>
            d && !d.pages[0]?.activities.some((x) => x.id === a.id)
              ? {
                  ...d,
                  pages: [
                    { ...d.pages[0], activities: [a, ...d.pages[0].activities] },
                    ...d.pages.slice(1),
                  ],
                }
              : d,
        );
    };
    const reload = () => queryClient.invalidateQueries({ queryKey: ['activities'] });
    socket.on('activity:new', added).on('connect', reload);
    return () => {
      socket.off('activity:new', added).off('connect', reload);
    };
  }, []);
}

const STATUS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

// "assigned “Fix login” to Ann" — the actor's name goes in front.
export function describe(a: Activity): string {
  const t = `“${a.targetName}”`;
  const m = a.metadata;
  switch (a.action) {
    case 'task.created':
      return `created task ${t}${m.assigneeName ? ` for ${m.assigneeName}` : ''}`;
    case 'task.assigned':
      if (m.assigneeId === null) return `unassigned ${t}`;
      return m.assigneeName ? `assigned ${t} to ${m.assigneeName}` : `reassigned ${t}`;
    case 'task.completed':
      return `completed ${t}`;
    case 'task.moved':
      return `moved ${t} to ${STATUS[String(m.status)] ?? m.status}`;
    case 'task.updated':
      return `edited ${t}`;
    case 'task.deleted':
      return `deleted task ${t}`;
    case 'employee.created':
      return `added ${a.targetName}`;
    case 'employee.updated':
      return `updated ${a.targetName}'s details`;
    case 'employee.deleted':
      return `removed ${a.targetName}`;
    case 'employee.invite_resent':
      return `resent ${a.targetName}'s invite`;
    case 'employee.setup_completed':
      return 'set up their account';
    case 'profile.updated':
      return 'updated their profile';
    case 'schedule.updated':
      return `updated ${a.targetName}'s schedule`;
    case 'auth.signed_in':
      return 'signed in';
    case 'auth.otp_failed':
      return 'entered a wrong sign-in code';
    case 'auth.login_failed':
      return 'failed a password sign-in';
    default:
      return `${a.action} ${a.targetName}`;
  }
}
