import { Redis } from 'ioredis';
import { env } from '../env.js';

// Fail fast instead of queueing commands while Upstash is unreachable; callers decide what a failure means.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 2000 });
redis.on('error', (err) => console.error('redis error:', err.message));
