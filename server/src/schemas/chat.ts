import { z } from 'zod';

// `<idA>_<idB>`, the two user ids sorted. User ids never contain "_" (Firestore auto-ids, seed ids use "-"),
// so the split is unambiguous; the service also checks it's the sorted form, so each pair has one conversation.
export const conversationId = z
  .string()
  .max(300)
  .regex(/^[A-Za-z0-9-]+_[A-Za-z0-9-]+$/, 'Invalid conversation');

export const conversationParams = z.object({ id: conversationId }).strict();

// `before` is the id of the oldest message the client already has; the page holds the ones before it.
export const messagesQuery = z
  .object({
    before: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();

// Socket `message:send`. The client makes the id (a UUID) before sending, so a retry of the same message is
// recognised instead of stored twice.
export const sendMessageSchema = z
  .object({
    conversationId,
    clientMessageId: z.string().uuid(),
    text: z.string().trim().min(1, 'Message is empty').max(2000, 'At most 2000 characters'),
  })
  .strict();
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
