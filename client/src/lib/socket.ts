import { io } from 'socket.io-client';

// undefined = same origin, which the vite dev proxy forwards to the server.
// ponytail: no auth token yet — phase 1 adds the handshake.
export const socket = io(import.meta.env.VITE_API_URL || undefined, {
  path: '/socket.io',
  transports: ['websocket'],
  withCredentials: true,
});
