import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, patch } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import type { AppNotification } from '../../lib/types';

const KEY = ['notifications'];
type Data = { notifications: AppNotification[]; unreadCount: number };

const write = (fn: (d: Data) => Data) =>
  queryClient.setQueryData<Data>(KEY, (d) => (d ? fn(d) : d));

// Marks ids read in the cache (unread count drops only for ones that were unread here).
const applyRead = (ids: string[] | 'all') =>
  write((d) => {
    const hit = (n: AppNotification) => ids === 'all' || ids.includes(n.id);
    const newlyRead = d.notifications.filter((n) => !n.read && hit(n)).length;
    return {
      notifications: d.notifications.map((n) => (hit(n) ? { ...n, read: true } : n)),
      unreadCount: ids === 'all' ? 0 : Math.max(0, d.unreadCount - newlyRead),
    };
  });

export function useNotifications() {
  return useQuery({ queryKey: KEY, queryFn: () => api<Data>('/notifications') });
}

// New notifications arrive over the socket; reads made in another tab are mirrored here; a reconnect reloads.
export function useNotificationEvents() {
  useEffect(() => {
    const added = (n: AppNotification) =>
      write((d) =>
        d.notifications.some((x) => x.id === n.id)
          ? d
          : { notifications: [n, ...d.notifications], unreadCount: d.unreadCount + 1 },
      );
    const read = ({ ids }: { ids: string[] }) => applyRead(ids);
    const reload = () => queryClient.invalidateQueries({ queryKey: KEY });
    socket.on('notification:new', added).on('notification:read', read).on('connect', reload);
    return () => {
      socket.off('notification:new', added).off('notification:read', read).off('connect', reload);
    };
  }, []);
}

// Optimistic: the badge drops immediately; a failure reloads the real state.
export function useMarkRead() {
  return useMutation({
    mutationFn: (ids: string[] | 'all') =>
      patch('/notifications/read', ids === 'all' ? { all: true } : { ids }),
    onMutate: applyRead,
    onError: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
