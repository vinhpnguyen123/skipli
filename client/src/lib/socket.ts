import { io } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';

// Production connects straight to Render (VITE_SOCKET_URL), not through Vercel's /api rewrite: the socket
// authenticates with the access token, not the cookie, so it has no reason to share the app's origin.
// Unset in dev = same origin via the Vite proxy.
// Connected by the app once signed in. `auth` is a function, so every (re)connect sends the current token.
export const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
  path: '/socket.io',
  transports: ['websocket'],
  withCredentials: true,
  autoConnect: false,
  auth: (cb) => cb({ token: getAccessToken() }),
});

// Neither a rejected handshake nor a server-side disconnect retries on its own. Refresh the session and
// reconnect; if the refresh fails (token gone, account deleted) the session ends and the route guard takes over.
async function reconnectWithFreshToken() {
  try {
    await refreshSession();
    socket.connect();
  } catch {
    // signed out
  }
}

socket.on('connect_error', (err) => {
  if (err.message === 'Access token expired' || err.message === 'Account unavailable')
    void reconnectWithFreshToken();
});
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') void reconnectWithFreshToken();
});
