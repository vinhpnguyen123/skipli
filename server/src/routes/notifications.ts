import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listNotifications, markRead } from '../services/notifications.js';

// `{ ids: [...] }` marks those, `{ all: true }` marks every unread one.
const markReadSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

// Mounted at /api. Always the signed-in user's own notifications.
export const notificationsRouter = Router();

notificationsRouter.get('/notifications', requireAuth, async (req, res) => {
  res.json(await listNotifications(req.user!));
});

notificationsRouter.patch(
  '/notifications/read',
  requireAuth,
  validate({ body: markReadSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof markReadSchema>;
    res.json({ success: true, ...(await markRead(req.user!, 'all' in body ? 'all' : body.ids)) });
  },
);
