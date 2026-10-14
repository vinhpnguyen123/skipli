import { z } from 'zod';

export const taskStatus = z.enum(['todo', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof taskStatus>;

const id = z.string().min(1).max(128);
// ISO 8601 with a timezone, e.g. 2026-10-20T17:00:00Z; stored as a UTC Timestamp.
const dueDate = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

const ownerFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  assigneeId: id.nullable(),
  dueDate: dueDate.nullable(),
};

export const createTaskSchema = z
  .object({
    ...ownerFields,
    description: ownerFields.description.default(''),
    assigneeId: ownerFields.assigneeId.default(null),
    dueDate: ownerFields.dueDate.default(null),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// `version` is the one the client last saw; a mismatch means someone else changed the task first (409).
// Which fields a caller may send is checked in the service: employees only status and order.
export const updateTaskSchema = z
  .object({
    version: z.number().int().positive(),
    ...ownerFields,
    status: taskStatus,
    // Position within a column; the client picks a number between the neighbours it's dropped between.
    order: z.number().finite(),
  })
  .partial()
  .required({ version: true })
  .strict()
  .refine((o) => Object.keys(o).length > 1, 'Nothing to update');
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskIdParams = z.object({ id }).strict();
// `none` lists unassigned tasks.
export const listTasksQuery = z.object({ assigneeId: id.optional() }).strict();
