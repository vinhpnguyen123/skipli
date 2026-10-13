import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';

const claimsSchema = z.object({ sub: z.string().min(1), role: z.enum(['owner', 'employee']) });

export type Role = z.infer<typeof claimsSchema>['role'];
export type AuthUser = { id: string; role: Role };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Shared by requireAuth and, later, the socket handshake.
export function verifyAccessToken(token: string): AuthUser {
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError('TOKEN_EXPIRED', 'Access token expired', 401);
    throw new AppError('UNAUTHENTICATED', 'Invalid access token', 401);
  }
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) throw new AppError('UNAUTHENTICATED', 'Invalid access token', 401);
  return { id: claims.data.sub, role: claims.data.role };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Missing access token', 401);
  req.user = verifyAccessToken(header.slice('Bearer '.length));
  next();
};

// Must run after requireAuth.
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw new AppError('FORBIDDEN', 'Not allowed', 403);
    next();
  };
