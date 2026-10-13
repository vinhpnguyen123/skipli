import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './env.js';
import { verifyAccessToken, type AuthUser } from './middleware/auth.js';

const httpServer = createServer(createApp());

// ponytail: no Redis adapter yet — single instance until phase 4 needs it.
export const io = new Server(httpServer, {
  path: '/socket.io',
  transports: ['websocket'],
  cors: { origin: env.APP_URL, credentials: true },
});

// The access token rides in the handshake; the client reconnects with a fresh one after refreshing.
io.use((socket, next) => {
  try {
    socket.data.user = verifyAccessToken(String(socket.handshake.auth?.token ?? ''));
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

httpServer.listen(env.PORT, () => {
  console.log(`api on http://localhost:${env.PORT}`);
});
