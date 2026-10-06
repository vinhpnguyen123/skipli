import { io } from 'socket.io-client';

// ponytail: no auth token yet — phase 1 adds the handshake.
export const socket = io({ path: '/socket.io', transports: ['websocket'] });
