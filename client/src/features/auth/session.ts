import { useMutation, useQuery } from '@tanstack/react-query';
import { post, refreshSession, setAccessToken } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import type { SessionResponse, User } from '../../lib/types';

// The signed-in user, or null. On first load it tries the refresh cookie, so a reload keeps you signed in.
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => refreshSession().catch((): User | null => null),
    staleTime: Infinity,
    retry: false,
  });
}

export function startSession(session: SessionResponse) {
  setAccessToken(session.accessToken);
  queryClient.setQueryData(['session'], session.user);
}

export function useLogout() {
  return useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      setAccessToken(null);
      socket.disconnect();
      // Update the session query in place: removing it would detach App's useSession observer,
      // and the UI wouldn't see the sign-out until a reload.
      queryClient.setQueryData(['session'], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    },
  });
}
