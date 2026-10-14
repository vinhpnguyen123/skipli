import express from 'express';
import request from 'supertest';

// env.ts reads ORIGIN_SECRET at import, so set it first.
process.env.ORIGIN_SECRET = 'test-origin-secret';
const { errorHandler } = await import('../lib/errors.js');
const { requireVercelOrigin } = await import('./origin.js');

const app = express();
app.set('trust proxy', 1);
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api', requireVercelOrigin);
app.get('/api/ip', (req, res) => {
  res.json({ ip: req.ip });
});
app.use(errorHandler);

describe('requireVercelOrigin', () => {
  it('rejects /api requests without the secret, so Vercel is the only way in', async () => {
    expect((await request(app).get('/api/ip')).status).toBe(403);
    expect((await request(app).get('/api/ip').set('x-origin-secret', 'wrong')).status).toBe(403);
  });

  it("uses Vercel's x-real-ip as the client IP, so rate limits see the visitor", async () => {
    const res = await request(app)
      .get('/api/ip')
      .set('x-origin-secret', 'test-origin-secret')
      .set('x-real-ip', '203.0.113.7')
      .set('x-forwarded-for', '203.0.113.7, 76.76.21.1'); // visitor, then Vercel's edge
    expect(res.status).toBe(200);
    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('leaves the health check open for Render', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
