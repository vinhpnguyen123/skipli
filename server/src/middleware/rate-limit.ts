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
  // What to do when Redis is unreachable. 'open' (default) lets the request through; 'memory' keeps
  // limiting with a per-process counter. Use 'memory' on OTP send/verify routes.
  onRedisDown?: 'open' | 'memory';
};

// ponytail: per-process counters, so with N instances the effective limit is N x limit while Redis is down.
// Only used during an outage; expired entries are swept once the map grows.
const memory = new Map<string, { count: number; resetAt: number }>();

function hitMemory(key: string, windowSec: number): { count: number; ttl: number } {
  const now = Date.now();
  if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  let entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowSec * 1000 };
    memory.set(key, entry);
  }
  entry.count++;
  return { count: entry.count, ttl: Math.ceil((entry.resetAt - now) / 1000) };
}

async function hitRedis(key: string, windowSec: number): Promise<{ count: number; ttl: number }> {
  const results = await redis.multi().incr(key).expire(key, windowSec, 'NX').ttl(key).exec();
  if (!results || results.some(([err]) => err)) throw new Error('rate limit transaction failed');
  return { count: results[0][1] as number, ttl: results[2][1] as number };
}

// Fixed-window counter: INCR + EXPIRE NX in one MULTI, so the window starts at the first hit and the
// key can't be left without a TTL. ponytail: fixed window allows up to 2x limit across a window edge;
// switch to a sliding window if that ever matters.
export const rateLimit =
  ({ name, limit, windowSec, by, target, onRedisDown = 'open' }: Options): RequestHandler =>
  async (req, res, next) => {
    const subject = by === 'ip' ? req.ip : target?.(req);
    if (!subject) return next();
    // Hash the subject so Redis never holds raw phone numbers or emails.
    const key = `rl:${by}:${name}:${createHash('sha256').update(subject).digest('hex')}`;

    let hit: { count: number; ttl: number };
    try {
      hit = await hitRedis(key, windowSec);
    } catch (err) {
      const reason = (err as Error).message;
      if (onRedisDown === 'open') {
        // OTP attempts are still capped per code in Firestore; this only drops the request-volume limit.
        console.warn(`rate limit '${name}' skipped, redis unavailable: ${reason}`);
        return next();
      }
      console.warn(`rate limit '${name}' using in-memory fallback, redis unavailable: ${reason}`);
      hit = hitMemory(key, windowSec);
    }

    if (hit.count > limit) {
      res.setHeader('Retry-After', String(Math.max(hit.ttl, 1)));
      throw new AppError('RATE_LIMITED', 'Too many requests, try again later', 429);
    }
    next();
  };
