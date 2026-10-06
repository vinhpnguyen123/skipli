import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './env.js';

const httpServer = createServer(createApp());

// ponytail: no Redis adapter yet — single instance until phase 4 needs it.
export const io = new Server(httpServer, {
  path: '/socket.io',
  transports: ['websocket'],
  cors: { origin: env.APP_URL, credentials: true },
});

io.on('connection', (socket) => {
  socket.on('ping:check', (cb?: (v: string) => void) => cb?.('pong'));
});

httpServer.listen(env.PORT, () => {
  console.log(`api on http://localhost:${env.PORT}`);
});
