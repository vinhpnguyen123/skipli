import { io } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';

// undefined = same origin, which the vite dev proxy forwards to the server.
// Connected by the app once signed in. `auth` is a function, so every (re)connect sends the current token.
export const socket = io(import.meta.env.VITE_API_URL || undefined, {
  path: '/socket.io',
  transports: ['websocket'],
  withCredentials: true,
  autoConnect: false,
  auth: (cb) => cb({ token: getAccessToken() }),
});

// A rejected handshake doesn't auto-retry. If the token had expired, refresh it and reconnect;
// if the refresh fails the session is over and the route guard takes over.
socket.on('connect_error', async (err) => {
  if (err.message !== 'Access token expired') return;
  try {
    await refreshSession();
    socket.connect();
  } catch {
    // signed out
  }
});
