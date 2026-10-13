import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../lib/errors.js';
import { redis } from '../lib/redis.js';
import { rateLimit } from './rate-limit.js';

// Unique name per run so counters from earlier runs (same IP, live Redis) don't leak in.
const run = randomUUID();
const app = express();
app.use(express.json());
app.post('/ip', rateLimit({ name: `test-ip-${run}`, limit: 2, windowSec: 60, by: 'ip' }), (_req, res) => {
  res.json({ ok: true });
});
app.post(
  '/target',
  rateLimit({ name: `test-target-${run}`, limit: 1, windowSec: 60, by: 'target', target: (req) => req.body.phone }),
  (_req, res) => {
    res.json({ ok: true });
  },
);
app.use(errorHandler);

afterAll(async () => {
  const keys = await redis.keys(`rl:*:test-*-${run}:*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

describe('rateLimit', () => {
  it('returns 429 with Retry-After once an IP passes the limit', async () => {
    expect((await request(app).post('/ip')).status).toBe(200);
    expect((await request(app).post('/ip')).status).toBe(200);
    const res = await request(app).post('/ip');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits each target separately', async () => {
    expect((await request(app).post('/target').send({ phone: '+15550001' })).status).toBe(200);
    expect((await request(app).post('/target').send({ phone: '+15550001' })).status).toBe(429);
    expect((await request(app).post('/target').send({ phone: '+15550002' })).status).toBe(200);
  });

  it('stores a TTL and never the raw target in the key', async () => {
    const keys = await redis.keys(`rl:target:test-target-${run}:*`);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.join()).not.toContain('+1555');
    expect(await redis.ttl(keys[0])).toBeGreaterThan(0);
  });

  it('fails open when Redis errors', async () => {
    const spy = jest.spyOn(redis, 'multi').mockImplementation(() => {
      throw new Error('down');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(app).post('/target').send({ phone: '+15550001' });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });
});
