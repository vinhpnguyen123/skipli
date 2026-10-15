import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import { ago } from '../../lib/time';

// Mirrors GET /presence and the presence:update event (server/src/socket/presence.ts).
type Presence = { online: string[]; lastSeen: Record<string, string> };
type Update = { userId: string; online: boolean; lastSeen: string | null };
const KEY = ['presence'];

export function usePresence() {
  return useQuery({ queryKey: KEY, queryFn: () => api<Presence>('/presence') }).data;
}

// Mounted once in the app shell. A reconnect reloads the snapshot (changes missed while offline).
export function usePresenceEvents() {
  useEffect(() => {
    const update = (u: Update) =>
      queryClient.setQueryData<Presence>(
        KEY,
        (p) =>
          p && {
            online: u.online
              ? [...new Set([...p.online, u.userId])]
              : p.online.filter((id) => id !== u.userId),
            lastSeen: u.lastSeen ? { ...p.lastSeen, [u.userId]: u.lastSeen } : p.lastSeen,
          },
      );
    const reload = () => queryClient.invalidateQueries({ queryKey: KEY });
    socket.on('presence:update', update).on('connect', reload);
    return () => {
      socket.off('presence:update', update).off('connect', reload);
    };
  }, []);
}

// "Online", "Last seen 5 minutes ago", or "Offline" when they've never connected.
export function useStatusOf(userId: string) {
  const p = usePresence();
  const online = !!p?.online.includes(userId);
  const seen = p?.lastSeen[userId];
  return { online, label: online ? 'Online' : seen ? `Last seen ${ago(seen)}` : 'Offline' };
}
