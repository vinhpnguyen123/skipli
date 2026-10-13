import { jest } from '@jest/globals';
import express from 'express';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

// In-memory Redis: no credentials, no quota. Real Redis is covered by rate-limit.integration.test.ts.
const redis = new RedisMock();
jest.unstable_mockModule('../lib/redis.js', () => ({ redis }));
const { errorHandler } = await import('../lib/errors.js');
const { rateLimit } = await import('./rate-limit.js');

const ok: express.RequestHandler = (_req, res) => {
  res.json({ ok: true });
};
const byPhone = (req: express.Request) => req.body.phone;

const app = express();
app.use(express.json());
app.post('/ip', rateLimit({ name: 'ip', limit: 2, windowSec: 60, by: 'ip' }), ok);
app.post('/target', rateLimit({ name: 'target', limit: 1, windowSec: 60, by: 'target', target: byPhone }), ok);
app.post(
  '/otp',
  rateLimit({ name: 'otp', limit: 1, windowSec: 60, by: 'target', target: byPhone, onRedisDown: 'memory' }),
  ok,
);
app.use(errorHandler);

beforeEach(async () => {
  await redis.flushall();
});
afterEach(() => {
  jest.restoreAllMocks();
});

const redisDown = () => {
  jest.spyOn(redis, 'multi').mockImplementation(() => {
    throw new Error('down');
  });
  return jest.spyOn(console, 'warn').mockImplementation(() => {});
};

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
    await request(app).post('/target').send({ phone: '+15550001' });
    const keys = await redis.keys('rl:target:target:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('+1555');
    expect(await redis.ttl(keys[0])).toBeGreaterThan(0);
  });

  it('fails open on general routes when Redis is down, with a warning', async () => {
    const warn = redisDown();
    expect((await request(app).post('/target').send({ phone: '+15550001' })).status).toBe(200);
    expect((await request(app).post('/target').send({ phone: '+15550001' })).status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it('keeps limiting OTP routes in memory when Redis is down, with a warning', async () => {
    const warn = redisDown();
    expect((await request(app).post('/otp').send({ phone: '+15550003' })).status).toBe(200);
    const res = await request(app).post('/otp').send({ phone: '+15550003' });
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });
});
