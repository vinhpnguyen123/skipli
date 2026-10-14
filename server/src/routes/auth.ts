import { Router, type Request, type Response } from 'express';
import { AppError } from '../lib/errors.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { getActiveUser, toPublicUser, type PublicUser } from '../services/users.js';
import {
  ACCESS_TOKEN_TTL_SEC,
  issueRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../services/session.js';

const COOKIE = 'rt';
// The browser reaches the API on the app's own origin (Vercel rewrites /api to Render; Vite proxies it in dev),
// so the cookie is first-party and SameSite=Lax: other sites' requests don't carry it.
// Path-scoped so it's only sent to the refresh/logout endpoints.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/api/auth',
} as const;

// Shared by every login route: access token in the body, refresh token in the cookie.
export async function startSession(res: Response, user: PublicUser) {
  const refresh = await issueRefreshToken(user.id);
  res.cookie(COOKIE, refresh, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
  return { accessToken: signAccessToken(user), expiresIn: ACCESS_TOKEN_TTL_SEC, user };
}

// Defense in depth on top of SameSite=Lax: a custom header forces a CORS preflight, which only APP_URL passes,
// so even a same-site page we don't control can't rotate or revoke someone's session.
function requireAppHeader(req: Request) {
  if (req.get('X-Requested-With') !== 'skipli') throw new AppError('FORBIDDEN', 'Not allowed', 403);
}

export const authRouter = Router();

authRouter.post(
  '/refresh',
  rateLimit({ name: 'refresh', limit: 60, windowSec: 900, by: 'ip' }),
  async (req, res) => {
    requireAppHeader(req);
    const raw: unknown = req.cookies?.[COOKIE];
    if (typeof raw !== 'string' || !raw) throw new AppError('UNAUTHENTICATED', 'No session', 401);
    try {
      const rotated = await rotateRefreshToken(raw);
      // Deleted or disabled since sign-in: the session ends here.
      const user = toPublicUser(await getActiveUser(rotated.userId));
      res.cookie(COOKIE, rotated.raw, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
      res.json({ accessToken: signAccessToken(user), expiresIn: ACCESS_TOKEN_TTL_SEC, user });
    } catch (err) {
      res.clearCookie(COOKIE, cookieOptions);
      throw err;
    }
  },
);

authRouter.post('/logout', async (req, res) => {
  requireAppHeader(req);
  const raw: unknown = req.cookies?.[COOKIE];
  if (typeof raw === 'string' && raw) await revokeRefreshToken(raw);
  res.clearCookie(COOKIE, cookieOptions);
  res.json({ success: true });
});
