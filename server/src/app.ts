import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env.js';
import { errorHandler } from './lib/errors.js';
import { requireVercelOrigin } from './middleware/origin.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { cronRouter } from './routes/cron.js';
import { employeeRouter } from './routes/employee.js';
import { employeesRouter } from './routes/employees.js';
import { meRouter } from './routes/me.js';
import { notificationsRouter } from './routes/notifications.js';
import { ownerRouter } from './routes/owner.js';
import { tasksRouter } from './routes/tasks.js';

export function createApp() {
  const app = express();
  // So req.ip is the client, not Render's load balancer. Rate limits key on it. Behind Vercel's rewrite,
  // requireVercelOrigin replaces it with Vercel's x-real-ip.
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  // Before the origin check: Render's health probe calls it directly.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use('/api', requireVercelOrigin, (_req, res, next) => {
    // Every API response is per-user; never let Vercel's CDN (or a browser) cache one.
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/owner', ownerRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/employee', employeeRouter);
  app.use('/api', employeesRouter);
  app.use('/api', meRouter);
  app.use('/api', tasksRouter);
  app.use('/api', notificationsRouter);
  app.use('/api', chatRouter);
  app.use('/api/cron', cronRouter);

  app.use(errorHandler);
  return app;
}
