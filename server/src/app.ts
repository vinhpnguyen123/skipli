import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env.js';
import { errorHandler } from './lib/errors.js';

export function createApp() {
  const app = express();
  // One proxy hop (Render's load balancer) so req.ip is the client, not the proxy. Rate limits key on it.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use(errorHandler);
  return app;
}
