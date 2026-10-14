import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../env.js';
import { authenticate, type AuthUser } from '../middleware/auth.js';

// Set once at startup. Undefined in tests that build only the Express app, so the helpers below no-op there.
let io: Server | undefined;

export function initSocket(httpServer: HttpServer): Server {
  // ponytail: no Redis adapter yet — single instance until phase 4 needs it.
  io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],
    cors: { origin: env.APP_URL, credentials: true },
  });

  // The access token rides in the handshake; the client reconnects with a fresh one after refreshing.
  io.use(async (socket, next) => {
    try {
      socket.data.user = await authenticate(String(socket.handshake.auth?.token ?? ''));
      next();
    } catch (err) {
      next(err as Error); // message reaches the client as connect_error ('Access token expired' etc.)
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    void socket.join(user.role === 'owner' ? [`user:${user.id}`, 'owner'] : `user:${user.id}`);
    socket.on('ping:check', (cb?: (v: string) => void) => cb?.('pong'));
  });

  return io;
}

// Drops every open socket of a user (e.g. after deleting them). They can't reconnect: the handshake
// re-checks the account.
export function disconnectUser(userId: string): void {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

// Sends one event to every socket in any of these rooms (a socket in several rooms gets it once).
// No-op in tests that build only the Express app.
export function emitTo(rooms: string[], event: string, data: unknown): void {
  if (rooms.length) io?.to(rooms).emit(event, data);
}
