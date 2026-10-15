import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { env } from '../env.js';
import { authenticate, type AuthUser } from '../middleware/auth.js';
import { redis } from '../lib/redis.js';
import { registerChatHandlers } from './chat.js';
import { startPresenceHeartbeat, trackPresence } from './presence.js';

// Set once at startup. Undefined in tests that build only the Express app, so the helpers below no-op there.
let io: Server | undefined;

// Under Jest (NODE_ENV=test, Redis mocked) there's one instance: no Redis adapter and no heartbeat timer.
// Presence still works there; tests drive the heartbeat with presenceTick().
export function initSocket(
  httpServer: HttpServer,
  { multiInstance = process.env.NODE_ENV !== 'test' } = {},
): Server {
  io = new Server(httpServer, {
    path: '/socket.io',
    transports: ['websocket'],
    cors: { origin: env.APP_URL, credentials: true },
    // Broadcasts, fetchSockets() and disconnectSockets() reach sockets on every instance via Redis pub/sub.
    // ponytail: if Redis is down, emits still reach this instance's sockets; cross-instance ones are lost.
    ...(multiInstance && { adapter: createAdapter(redis.duplicate(), redis.duplicate()) }),
  });
  if (multiInstance) startPresenceHeartbeat(io);

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
    registerChatHandlers(socket, user);
    trackPresence(io!, socket, user.id);
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

// Whether the user has any open socket (any tab, any device). False in tests that build only the Express app.
// fetchSockets() asks every instance through the Redis adapter. If that fails (Redis down, an instance not
// answering) the answer is "not online": an extra email beats a silently dropped one.
export async function isOnline(userId: string): Promise<boolean> {
  if (!io) return false;
  try {
    return (await io.in(`user:${userId}`).fetchSockets()).length > 0;
  } catch (err) {
    console.warn(
      `online check for user ${userId} failed, treating as offline:`,
      (err as Error).message,
    );
    return false;
  }
}
