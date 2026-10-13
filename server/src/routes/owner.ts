import { Router, type Request } from 'express';
import { rateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { createNewAccessCodeSchema, validateOwnerAccessCodeSchema } from '../schemas/auth.js';
import { loginOwnerWithCode, sendOwnerCode } from '../services/auth.js';
import { startSession } from './auth.js';

const byPhone = (req: Request) => req.body.phoneNumber;
// OTP routes keep limiting in memory if Redis is down (see rate-limit.ts).
const otp = { onRedisDown: 'memory' } as const;

export const ownerRouter = Router();

ownerRouter.post(
  '/CreateNewAccessCode',
  rateLimit({ name: 'otp-send', limit: 20, windowSec: 3600, by: 'ip', ...otp }),
  validate({ body: createNewAccessCodeSchema }),
  rateLimit({ name: 'otp-send', limit: 5, windowSec: 900, by: 'target', target: byPhone, ...otp }),
  async (req, res) => {
    const { accessCode } = await sendOwnerCode(req.body.phoneNumber);
    res.json({ success: true, ...(accessCode && { accessCode }) });
  },
);

ownerRouter.post(
  '/ValidateAccessCode',
  rateLimit({ name: 'otp-verify', limit: 30, windowSec: 900, by: 'ip', ...otp }),
  validate({ body: validateOwnerAccessCodeSchema }),
  async (req, res) => {
    const user = await loginOwnerWithCode(req.body.phoneNumber, req.body.accessCode);
    res.json({ success: true, ...(await startSession(res, user)) });
  },
);
