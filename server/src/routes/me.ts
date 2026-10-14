import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateProfileSchema } from '../schemas/employees.js';
import { getProfile, updateProfile } from '../services/profile.js';

// Mounted at /api. Any signed-in user, always acting on themselves (no id in the URL, so no IDOR surface).
export const meRouter = Router();

meRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await getProfile(req.user!));
});

meRouter.patch('/me', requireAuth, validate({ body: updateProfileSchema }), async (req, res) => {
  res.json(await updateProfile(req.user!, req.body));
});
