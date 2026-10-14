import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { sendDueReminders } from '../services/reminders.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

// Only the scheduler knows CRON_SECRET. (The origin check in front only proves a request came through Vercel,
// which anyone's can.) Unset secret = nothing gets in.
const requireCronSecret: RequestHandler = (req, _res, next) => {
  const secret = env.CRON_SECRET;
  const header = req.get('authorization') ?? '';
  const sent = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!secret || !timingSafeEqual(digest(sent), digest(secret))) {
    throw new AppError('UNAUTHENTICATED', 'Not allowed', 401);
  }
  next();
};

// Mounted at /api/cron. Called hourly by .github/workflows/due-reminders.yml.
export const cronRouter = Router();

cronRouter.post('/due-reminders', requireCronSecret, async (_req, res) => {
  res.json({ success: true, ...(await sendDueReminders()) });
});
