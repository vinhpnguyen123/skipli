import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { conversationParams, messagesQuery } from '../schemas/chat.js';
import { listConversations, listDirectory, listMessages, markRead } from '../services/chat.js';
import { getPresence } from '../socket/presence.js';

// Mounted at /api. Any signed-in user; conversation access is checked in the service (participants only).
// Sending a message is a socket event (`message:send`, see socket/chat.ts), not a route.
export const chatRouter = Router();

chatRouter.get('/directory', requireAuth, async (req, res) => {
  res.json({ people: await listDirectory(req.user!) });
});

// Who's online and everyone's last seen; `presence:update` keeps it current after this.
chatRouter.get('/presence', requireAuth, async (_req, res) => {
  res.json(await getPresence());
});

chatRouter.get('/conversations', requireAuth, async (req, res) => {
  res.json({ conversations: await listConversations(req.user!) });
});

chatRouter.get(
  '/conversations/:id/messages',
  requireAuth,
  validate({ params: conversationParams, query: messagesQuery }),
  async (req, res) => {
    const { before, limit } = req.query as unknown as { before?: string; limit: number };
    res.json(await listMessages(req.user!, req.params.id as string, before, limit));
  },
);

chatRouter.post(
  '/conversations/:id/read',
  requireAuth,
  validate({ params: conversationParams }),
  async (req, res) => {
    res.json({ success: true, ...(await markRead(req.user!, req.params.id as string)) });
  },
);
