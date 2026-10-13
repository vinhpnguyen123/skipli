import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';

// Opt-in: RUN_REDIS_INTEGRATION=1 TEST_REDIS_URL=<separate test Redis> npm test
const enabled = process.env.RUN_REDIS_INTEGRATION === '1';
if (enabled) {
  const testUrl = process.env.TEST_REDIS_URL;
  if (!testUrl) throw new Error('RUN_REDIS_INTEGRATION=1 needs TEST_REDIS_URL');
  if (testUrl === process.env.REDIS_URL) throw new Error('TEST_REDIS_URL must not be the app REDIS_URL');
  // lib/redis connects to REDIS_URL on import, so point it at the test instance first.
  process.env.REDIS_URL = testUrl;
}

(enabled ? describe : describe.skip)('rateLimit against real Redis', () => {
  const run = randomUUID();
  let app: express.Express;
  let redis: (typeof import('../lib/redis.js'))['redis'];

  beforeAll(async () => {
    ({ redis } = await import('../lib/redis.js'));
    const { rateLimit } = await import('./rate-limit.js');
    const { errorHandler } = await import('../lib/errors.js');
    app = express();
    app.post('/ip', rateLimit({ name: `it-${run}`, limit: 1, windowSec: 60, by: 'ip' }), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
  });

  afterAll(async () => {
    const keys = await redis.keys(`rl:ip:it-${run}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('counts across requests and keeps the window TTL from the first hit', async () => {
    expect((await request(app).post('/ip')).status).toBe(200);
    const [key] = await redis.keys(`rl:ip:it-${run}:*`);
    const firstTtl = await redis.ttl(key);
    expect(firstTtl).toBeGreaterThan(0);
    const res = await request(app).post('/ip');
    expect(res.status).toBe(429);
    // EXPIRE NX: the second hit must not push the window out.
    expect(await redis.ttl(key)).toBeLessThanOrEqual(firstTtl);
  });
});
