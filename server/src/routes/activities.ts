import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listActivities } from '../services/activity.js';

const listQuery = z
  .object({
    visibility: z.enum(['feed', 'audit']).optional(),
    cursor: z.string().min(1).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

// Mounted at /api. Owner only: the audit log names people and records failed sign-ins.
export const activitiesRouter = Router();

activitiesRouter.get(
  '/activities',
  requireAuth,
  requireRole('owner'),
  validate({ query: listQuery }),
  async (req, res) => {
    res.json(await listActivities(req.query as unknown as z.infer<typeof listQuery>));
  },
);
