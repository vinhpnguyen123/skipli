import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { employeeIdParams } from '../schemas/employees.js';
import { scheduleSchema } from '../schemas/schedules.js';
import { getSchedule, listSchedules, putSchedule } from '../services/schedules.js';

// Mounted at /api. The owner edits; employees read their own (others' → 404).
export const schedulesRouter = Router();

schedulesRouter.get('/schedules', requireAuth, async (req, res) => {
  res.json({ schedules: await listSchedules(req.user!) });
});

schedulesRouter.get(
  '/employees/:id/schedule',
  requireAuth,
  validate({ params: employeeIdParams }),
  async (req, res) => {
    res.json(await getSchedule(req.user!, req.params.id as string));
  },
);

schedulesRouter.put(
  '/employees/:id/schedule',
  requireAuth,
  requireRole('owner'),
  validate({ params: employeeIdParams, body: scheduleSchema }),
  async (req, res) => {
    res.json(await putSchedule(req.user!, req.params.id as string, req.body.shifts));
  },
);
