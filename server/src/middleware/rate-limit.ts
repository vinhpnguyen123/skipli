import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { redis } from '../lib/redis.js';

type Options = {
  name: string; // route name in the key, e.g. 'owner-code'
  limit: number;
  windowSec: number;
  by: 'ip' | 'target';
  // For by: 'target' — the phone/email the request is about. Run after validate() so it's normalized.
  target?: (req: Request) => string | undefined;
};

// Fixed-window counter: INCR + EXPIRE NX in one MULTI, so the window starts at the first hit and the
// key can't be left without a TTL. ponytail: fixed window allows up to 2x limit across a window edge;
// switch to a sliding window if that ever matters.
export const rateLimit =
  ({ name, limit, windowSec, by, target }: Options): RequestHandler =>
  async (req, res, next) => {
    const subject = by === 'ip' ? req.ip : target?.(req);
    if (!subject) return next();
    // Hash the subject so Redis never holds raw phone numbers or emails.
    const key = `rl:${by}:${name}:${createHash('sha256').update(subject).digest('hex')}`;

    let count: number;
    let ttl: number;
    try {
      const results = await redis.multi().incr(key).expire(key, windowSec, 'NX').ttl(key).exec();
      if (!results || results.some(([err]) => err)) throw new Error('rate limit transaction failed');
      count = results[0][1] as number;
      ttl = results[2][1] as number;
    } catch (err) {
      // Fail open: a Redis outage shouldn't lock everyone out of login. OTP attempts are still capped
      // per code in Firestore, so this only loses the request-volume limit while Redis is down.
      console.error('rate limit skipped:', (err as Error).message);
      return next();
    }

    if (count > limit) {
      res.setHeader('Retry-After', String(Math.max(ttl, 1)));
      throw new AppError('RATE_LIMITED', 'Too many requests, try again later', 429);
    }
    next();
  };
