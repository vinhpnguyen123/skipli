import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { z } from 'zod';
import { env } from '../env.js';
import { errorHandler } from '../lib/errors.js';
import { assertCanAccess } from '../services/authz.js';
import { requireAuth, requireRole, type Role } from './auth.js';
import { validate } from './validate.js';

const app = express();
app.use(express.json());
app.post('/echo', validate(z.object({ name: z.string().min(1) }).strict()), (req, res) => {
  res.json(req.body);
});
app.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});
app.get('/owner-only', requireAuth, requireRole('owner'), (_req, res) => {
  res.json({ ok: true });
});
app.get('/resources/:ownerId', requireAuth, (req, res) => {
  assertCanAccess(req.user!, req.params.ownerId as string);
  res.json({ ok: true });
});
app.use(errorHandler);

const sign = (id: string, role: Role, secret = env.JWT_ACCESS_SECRET) =>
  jwt.sign({ role }, secret, { subject: id, expiresIn: '15m' });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('validate', () => {
  it('passes parsed body to the handler', async () => {
    const res = await request(app).post('/echo').send({ name: 'Ann' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Ann' });
  });

  it('rejects unknown fields', async () => {
    const res = await request(app).post('/echo').send({ name: 'Ann', role: 'owner' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing required field with its path', async () => {
    const res = await request(app).post('/echo').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('name');
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/echo').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('requireAuth', () => {
  it('sets req.user from a valid token', async () => {
    const res = await request(app).get('/me').set(bearer(sign('u1', 'employee')));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'u1', role: 'employee' });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns token_expired for an expired token', async () => {
    const expired = jwt.sign({ role: 'owner', exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_ACCESS_SECRET, {
      subject: 'u1',
    });
    const res = await request(app).get('/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token signed with another secret', async () => {
    const res = await request(app).get('/me').set(bearer(sign('u1', 'owner', 'wrong-secret')));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an unsigned (alg none) token', async () => {
    const unsigned = jwt.sign({ role: 'owner' }, '', { algorithm: 'none', subject: 'u1' });
    const res = await request(app).get('/me').set(bearer(unsigned));
    expect(res.status).toBe(401);
  });

  it('rejects a token with an unknown role', async () => {
    const token = jwt.sign({ role: 'admin' }, env.JWT_ACCESS_SECRET, { subject: 'u1' });
    const res = await request(app).get('/me').set(bearer(token));
    expect(res.status).toBe(401);
  });
});

describe('requireRole', () => {
  it('lets the owner through', async () => {
    const res = await request(app).get('/owner-only').set(bearer(sign('o1', 'owner')));
    expect(res.status).toBe(200);
  });

  it('returns 403 when an employee calls an owner route', async () => {
    const res = await request(app).get('/owner-only').set(bearer(sign('u1', 'employee')));
    expect(res.status).toBe(403);
  });
});

describe('assertCanAccess', () => {
  it('lets an employee access their own resource', async () => {
    const res = await request(app).get('/resources/u1').set(bearer(sign('u1', 'employee')));
    expect(res.status).toBe(200);
  });

  it("blocks an employee from another employee's resource with 404", async () => {
    const res = await request(app).get('/resources/u2').set(bearer(sign('u1', 'employee')));
    expect(res.status).toBe(404);
  });

  it('lets the owner access any resource', async () => {
    const res = await request(app).get('/resources/u2').set(bearer(sign('o1', 'owner')));
    expect(res.status).toBe(200);
  });
});
