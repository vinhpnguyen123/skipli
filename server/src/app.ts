import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env.js';
import { errorHandler } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { ownerRouter } from './routes/owner.js';

export function createApp() {
  const app = express();
  // So req.ip is the client, not Render's load balancer. Rate limits key on it.
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });
  app.use('/api/owner', ownerRouter);
  app.use('/api/auth', authRouter);

  app.use(errorHandler);
  return app;
}
