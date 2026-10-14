import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createTaskSchema,
  listTasksQuery,
  taskIdParams,
  updateTaskSchema,
} from '../schemas/tasks.js';
import { createTask, deleteTask, listTasks, updateTask } from '../services/tasks.js';

const owner = [requireAuth, requireRole('owner')];

// Mounted at /api. Owners manage every task; employees see and move only their own (checked in the service).
export const tasksRouter = Router();

tasksRouter.get('/tasks', requireAuth, validate({ query: listTasksQuery }), async (req, res) => {
  const { assigneeId } = req.query as { assigneeId?: string };
  res.json({ tasks: await listTasks(req.user!, assigneeId) });
});

tasksRouter.post('/tasks', ...owner, validate({ body: createTaskSchema }), async (req, res) => {
  res.status(201).json(await createTask(req.user!, req.body));
});

tasksRouter.patch(
  '/tasks/:id',
  requireAuth,
  validate({ params: taskIdParams, body: updateTaskSchema }),
  async (req, res) => {
    res.json(await updateTask(req.user!, req.params.id as string, req.body));
  },
);

tasksRouter.delete('/tasks/:id', ...owner, validate({ params: taskIdParams }), async (req, res) => {
  await deleteTask(req.user!, req.params.id as string);
  res.json({ success: true });
});
