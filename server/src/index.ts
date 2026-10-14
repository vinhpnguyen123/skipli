import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './env.js';
import { initSocket } from './socket/index.js';

const httpServer = createServer(createApp());
initSocket(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`api on http://localhost:${env.PORT}`);
});
