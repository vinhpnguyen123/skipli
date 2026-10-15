import type { Socket } from 'socket.io';
import { AppError } from '../lib/errors.js';
import type { AuthUser } from '../middleware/auth.js';
import { consume } from '../middleware/rate-limit.js';
import { sendMessageSchema } from '../schemas/chat.js';
import { participantsOf, sendMessage, type Message } from '../services/chat.js';

export type SendAck =
  | { ok: true; message: Message }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

// Turns any failure into the ack shape the client expects; never leaks internals (same rule as errorHandler).
function toAckError(err: unknown): SendAck {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
  }
  console.error(err);
  return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } };
}

// Chat send is the one write that arrives over the socket. It goes through the same validation, rate limit and
// mutate() path as a REST call; the ack tells the client whether to show the message as sent or failed.
export function registerChatHandlers(socket: Socket, user: AuthUser) {
  socket.on('message:send', async (payload: unknown, ack?: (res: SendAck) => void) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const parsed = sendMessageSchema.safeParse(payload);
      if (!parsed.success) {
        const details = parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        throw new AppError(
          'VALIDATION_ERROR',
          details[0]?.message ?? 'Invalid message',
          400,
          details,
        );
      }
      await consume({ name: 'chat-send', limit: 20, windowSec: 10, by: 'user', subject: user.id });
      reply({ ok: true, message: await sendMessage(user, parsed.data) });
    } catch (err) {
      reply(toAckError(err));
    }
  });

  // Typing: relayed to the other participant's tabs, never stored. The client sends start at most every
  // couple of seconds while typing and the receiver hides the indicator 3s after the last one, so a lost
  // stop can't leave it stuck. Not someone's conversation = silently dropped.
  let lastStart = 0;
  const relay = (event: 'typing:start' | 'typing:stop') => (payload: unknown) => {
    const conversationId = (payload as { conversationId?: unknown } | null)?.conversationId;
    if (typeof conversationId !== 'string' || conversationId.length > 300) return;
    if (event === 'typing:start') {
      if (Date.now() - lastStart < 1000) return; // ponytail: per-socket throttle, no Redis hit per keystroke
      lastStart = Date.now();
    }
    try {
      const { other } = participantsOf(user, conversationId);
      socket.to(`user:${other}`).emit(event, { conversationId, userId: user.id });
    } catch {
      // not a participant
    }
  };
  socket.on('typing:start', relay('typing:start'));
  socket.on('typing:stop', relay('typing:stop'));
}
