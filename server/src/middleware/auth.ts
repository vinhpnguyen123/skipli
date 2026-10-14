import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { getActiveUser } from '../services/users.js';

const claimsSchema = z.object({ sub: z.string().min(1), role: z.enum(['owner', 'employee']) });

export type Role = z.infer<typeof claimsSchema>['role'];
// What the access token says; verified offline.
export type TokenClaims = { id: string; role: Role };
// The signed-in user after checking the account still exists and is active.
export type AuthUser = TokenClaims & { name: string };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function verifyAccessToken(token: string): TokenClaims {
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError)
      throw new AppError('TOKEN_EXPIRED', 'Access token expired', 401);
    throw new AppError('UNAUTHENTICATED', 'Invalid access token', 401);
  }
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) throw new AppError('UNAUTHENTICATED', 'Invalid access token', 401);
  return { id: claims.data.sub, role: claims.data.role };
}

// Shared by requireAuth and the socket handshake. A valid token is not enough: the account must still
// exist and be active, so deleting an employee cuts them off immediately rather than in up to 15 min.
// ponytail: one Firestore read per request (~5-10 ms); cache per user for a few seconds if it shows up in latency.
export async function authenticate(token: string): Promise<AuthUser> {
  const claims = verifyAccessToken(token);
  const snap = await getActiveUser(claims.id);
  const data = snap.data()!;
  return { id: snap.id, role: data.role, name: data.name };
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    throw new AppError('UNAUTHENTICATED', 'Missing access token', 401);
  req.user = await authenticate(header.slice('Bearer '.length));
  next();
};

// Must run after requireAuth.
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      throw new AppError('FORBIDDEN', 'Not allowed', 403);
    next();
  };
