import { Router, type Request } from 'express';
import { rateLimit } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import {
  loginEmailSchema,
  passwordLoginSchema,
  setupCheckSchema,
  setupSchema,
  validateEmployeeAccessCodeSchema,
} from '../schemas/onboarding.js';
import { loginWithCode, loginWithPassword, sendLoginCode } from '../services/auth.js';
import { checkSetupToken, completeSetup } from '../services/onboarding.js';
import { startSession } from './auth.js';

// Login routes keep limiting in memory if Redis is down (see rate-limit.ts).
const strict = { onRedisDown: 'memory' } as const;
const byEmail = (req: Request) => req.body.email;
const byUsername = (req: Request) => req.body.username;

// Mounted at /api/employee. Spec names (LoginEmail, ValidateAccessCode) stay exactly as written.
export const employeeRouter = Router();

employeeRouter.post(
  '/setup/check',
  rateLimit({ name: 'setup', limit: 30, windowSec: 900, by: 'ip', ...strict }),
  validate({ body: setupCheckSchema }),
  async (req, res) => {
    res.json(await checkSetupToken(req.body.token));
  },
);

employeeRouter.post(
  '/setup',
  rateLimit({ name: 'setup', limit: 30, windowSec: 900, by: 'ip', ...strict }),
  validate({ body: setupSchema }),
  async (req, res) => {
    const { token, username, password } = req.body;
    res.json({ success: true, ...(await completeSetup(token, username, password)) });
  },
);

employeeRouter.post(
  '/login',
  rateLimit({ name: 'password-login', limit: 30, windowSec: 900, by: 'ip', ...strict }),
  validate({ body: passwordLoginSchema }),
  rateLimit({
    name: 'password-login',
    limit: 10,
    windowSec: 900,
    by: 'target',
    target: byUsername,
    ...strict,
  }),
  async (req, res) => {
    const user = await loginWithPassword(req.body.username, req.body.password);
    res.json({ success: true, ...(await startSession(res, user)) });
  },
);

employeeRouter.post(
  '/LoginEmail',
  rateLimit({ name: 'otp-send', limit: 20, windowSec: 3600, by: 'ip', ...strict }),
  validate({ body: loginEmailSchema }),
  rateLimit({
    name: 'otp-send',
    limit: 5,
    windowSec: 900,
    by: 'target',
    target: byEmail,
    ...strict,
  }),
  async (req, res) => {
    const { accessCode } = await sendLoginCode('employee', 'email', req.body.email);
    res.json({ success: true, ...(accessCode && { accessCode }) });
  },
);

employeeRouter.post(
  '/ValidateAccessCode',
  rateLimit({ name: 'otp-verify', limit: 30, windowSec: 900, by: 'ip', ...strict }),
  validate({ body: validateEmployeeAccessCodeSchema }),
  async (req, res) => {
    const user = await loginWithCode('employee', 'email', req.body.email, req.body.accessCode);
    res.json({ success: true, ...(await startSession(res, user)) });
  },
);
