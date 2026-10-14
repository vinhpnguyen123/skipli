import { randomInt, randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis and Twilio are mocked.
process.env.DEMO_MODE = 'true';
const redis = new RedisMock();
const sendSms = jest.fn<(to: string, body: string) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/redis.js', () => ({ redis }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }));
const { Timestamp } = await import('firebase-admin/firestore');
const { db } = await import('../lib/firebase.js');
const { codeRef } = await import('../services/access-code.js');
const { verifyAccessToken } = await import('../middleware/auth.js');
const { createApp } = await import('../app.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
const phone = () => `+1555${randomInt(1_000_000, 9_999_999)}`;
const owner = { id: `test-owner-${run}`, phone: phone() };
const demoOwner = { id: `test-demo-owner-${run}`, phone: phone() };
const ids = [owner.id, demoOwner.id];

const sendCode = (phoneNumber: string) =>
  request(app).post('/api/owner/CreateNewAccessCode').send({ phoneNumber });
const validateCode = (phoneNumber: string, accessCode: string) =>
  request(app).post('/api/owner/ValidateAccessCode').send({ phoneNumber, accessCode });
const smsCode = () => /\d{6}/.exec(sendSms.mock.calls.at(-1)![1])![0];
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
const refreshCookie = (res: request.Response) =>
  ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('rt='))!
    .split(';')[0];
const refresh = (cookie: string) =>
  request(app).post('/api/auth/refresh').set('X-Requested-With', 'skipli').set('Cookie', cookie);

async function signIn() {
  await sendCode(owner.phone);
  return validateCode(owner.phone, smsCode());
}

beforeAll(async () => {
  const base = {
    role: 'owner',
    email: 'x@example.com',
    department: 'Test',
    title: 'Test',
    status: 'active',
  };
  await db
    .collection('users')
    .doc(owner.id)
    .set({ ...base, name: 'Test Owner', phone: owner.phone, demo: false });
  await db
    .collection('users')
    .doc(demoOwner.id)
    .set({ ...base, name: 'Demo', phone: demoOwner.phone, demo: true });
});

beforeEach(async () => {
  await redis.flushall();
  sendSms.mockClear();
});

afterAll(async () => {
  const batch = db.batch();
  for (const id of ids) batch.delete(db.collection('users').doc(id));
  for (const p of [owner.phone, demoOwner.phone]) batch.delete(codeRef('phone', p));
  for (const q of ['refreshTokens', 'activities']) {
    const field = q === 'refreshTokens' ? 'userId' : 'actorId';
    for (const doc of (await db.collection(q).where(field, 'in', ids).get()).docs)
      batch.delete(doc.ref);
  }
  await batch.commit();
});

describe('CreateNewAccessCode', () => {
  it('answers the same for an unknown number and sends nothing', async () => {
    const res = await sendCode(phone());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('texts the owner a code and stores only its HMAC', async () => {
    const res = await sendCode(owner.phone);
    expect(res.body).toEqual({ success: true });
    expect(sendSms).toHaveBeenCalledWith(owner.phone, expect.any(String));
    const stored = (await codeRef('phone', owner.phone).get()).data()!;
    expect(stored.codeHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(smsCode());
  });

  it('returns the code to a demo account in demo mode instead of texting it', async () => {
    const res = await sendCode(demoOwner.phone);
    expect(res.body.accessCode).toMatch(/^\d{6}$/);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('accepts a formatted number', async () => {
    const formatted = owner.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '+1 ($1) $2-$3');
    expect((await sendCode(formatted)).status).toBe(200);
    expect(sendSms).toHaveBeenCalledWith(owner.phone, expect.any(String));
  });

  it('rejects unknown fields', async () => {
    const res = await request(app)
      .post('/api/owner/CreateNewAccessCode')
      .send({ phoneNumber: owner.phone, x: 1 });
    expect(res.status).toBe(400);
  });

  it('rate limits requests for the same number', async () => {
    for (let i = 0; i < 5; i++) expect((await sendCode(owner.phone)).status).toBe(200);
    const res = await sendCode(owner.phone);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('ValidateAccessCode (owner)', () => {
  it('signs in with a valid code, resets the code to an empty string, and sets the refresh cookie', async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, user: { id: owner.id, role: 'owner' } });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(verifyAccessToken(res.body.accessToken)).toEqual({ id: owner.id, role: 'owner' });
    expect(refreshCookie(res)).toMatch(/^rt=.+/);
    expect((await codeRef('phone', owner.phone).get()).data()!.codeHmac).toBe('');
  });

  it('rejects a code that was already used', async () => {
    await sendCode(owner.phone);
    const code = smsCode();
    expect((await validateCode(owner.phone, code)).status).toBe(200);
    const res = await validateCode(owner.phone, code);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('rejects an expired code', async () => {
    await sendCode(owner.phone);
    await codeRef('phone', owner.phone).update({
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    });
    const res = await validateCode(owner.phone, smsCode());
    expect(res.body.error.code).toBe('CODE_EXPIRED');
  });

  it('locks after 5 wrong attempts, even for the right code', async () => {
    await sendCode(owner.phone);
    const code = smsCode();
    for (let i = 0; i < 4; i++)
      expect((await validateCode(owner.phone, wrong(code))).body.error.code).toBe('INVALID_CODE');
    expect((await validateCode(owner.phone, wrong(code))).status).toBe(423);
    const res = await validateCode(owner.phone, code);
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('CODE_LOCKED');
  });

  it('a new code clears the lock', async () => {
    await sendCode(owner.phone);
    for (let i = 0; i < 5; i++) await validateCode(owner.phone, wrong(smsCode()));
    expect((await signIn()).status).toBe(200);
  });

  it('rejects a code for a number that is not an owner', async () => {
    const res = await validateCode(phone(), '123456');
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('writes audit entries for failed and successful sign-ins', async () => {
    await sendCode(owner.phone);
    await validateCode(owner.phone, wrong(smsCode()));
    await validateCode(owner.phone, smsCode());
    await new Promise((r) => setTimeout(r, 500)); // audit writes are fire-and-forget
    const snap = await db.collection('activities').where('actorId', '==', owner.id).get();
    const actions = snap.docs.map((d) => d.data());
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'auth.otp_failed',
          visibility: 'audit',
          metadata: expect.objectContaining({ reason: 'INVALID_CODE' }),
        }),
        expect.objectContaining({ action: 'auth.signed_in', visibility: 'audit' }),
      ]),
    );
  });
});

describe('refresh tokens', () => {
  it('rotates: a refresh returns a new access token and a new cookie', async () => {
    const first = refreshCookie(await signIn());
    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.accessToken).id).toBe(owner.id);
    expect(refreshCookie(res)).not.toBe(first);
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    const first = refreshCookie(await signIn());
    const second = refreshCookie(await refresh(first));
    expect((await refresh(first)).status).toBe(401);
    expect((await refresh(second)).status).toBe(401);
  });

  it('refuses a refresh without the app header (CSRF guard)', async () => {
    const cookie = refreshCookie(await signIn());
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  it('logout revokes the refresh token', async () => {
    const cookie = refreshCookie(await signIn());
    await request(app)
      .post('/api/auth/logout')
      .set('X-Requested-With', 'skipli')
      .set('Cookie', cookie);
    expect((await refresh(cookie)).status).toBe(401);
  });
});
