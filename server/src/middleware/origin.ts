import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';

// Fixed-length digests, so timingSafeEqual never throws on a length mismatch.
const digest = (s: string) => createHash('sha256').update(s).digest();

// In production the browser reaches /api through Vercel's rewrite (same site as the app, so the refresh cookie
// is first-party). Vercel adds x-origin-secret on that rewrite, and this rejects requests that skip it.
// Because only Vercel can get through, its x-real-ip (the visitor, set by Vercel and not spoofable through it)
// can be trusted as req.ip, which the per-IP rate limits key on. Off when ORIGIN_SECRET is unset (dev, tests).
export const requireVercelOrigin: RequestHandler = (req, _res, next) => {
  const secret = env.ORIGIN_SECRET;
  if (!secret) return next();
  if (!timingSafeEqual(digest(req.get('x-origin-secret') ?? ''), digest(secret))) {
    throw new AppError('FORBIDDEN', 'Not allowed', 403);
  }
  const visitor = req.get('x-real-ip');
  // req.ip is a getter on Express's prototype; shadow it on this request.
  if (visitor) Object.defineProperty(req, 'ip', { value: visitor, enumerable: true });
  next();
};
