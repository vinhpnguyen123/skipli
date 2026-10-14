import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis, SMS and email are mocked.
process.env.DEMO_MODE = 'true';
type Email = { to: string; subject: string; text: string; html: string };
const sendEmail = jest.fn<(e: Email) => Promise<void>>().mockResolvedValue(undefined);
const redis = new RedisMock();
jest.unstable_mockModule('../lib/redis.js', () => ({ redis }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({ sendEmail, escapeHtml: (s: string) => s }));
const { Timestamp } = await import('firebase-admin/firestore');
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { signAccessToken } = await import('../services/session.js');
const { verifyAccessToken } = await import('../middleware/auth.js');
const { hashSetupToken } = await import('../services/setup-token.js');
const { codeRef } = await import('../services/access-code.js');

// bcrypt at cost 12 takes ~250 ms per check; the lockout tests make several in a row.
jest.setTimeout(30_000);

const app = createApp();
const run = randomUUID().slice(0, 8);
const owner = { id: `test-owner-${run}`, role: 'owner' as const };
const asOwner = () => ({ Authorization: `Bearer ${signAccessToken(owner)}` });
const users = db.collection('users');
const created: string[] = [];
let n = 0;
const PASSWORD = 'correct horse battery';

const api = (path: string, body: object) => request(app).post(`/api/employee${path}`).send(body);
const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;
const lastEmailCode = () => /\d{6}/.exec(sendEmail.mock.calls.at(-1)![0].text)![0];

// An invited employee and their setup token, created through the owner API.
async function invite(extra: Record<string, unknown> = {}) {
  const email = `onb-${run}-${++n}@example.com`;
  const res = await request(app)
    .post('/api/CreateEmployee')
    .set(asOwner())
    .send({ name: `Onboard ${n}`, email, department: 'QA', ...extra });
  created.push(res.body.employeeId);
  return { id: res.body.employeeId as string, email, token: tokenFrom(res.body.setupUrl) };
}

// An employee who finished setup with PASSWORD.
async function activeEmployee() {
  const emp = await invite();
  const username = `user-${run}-${n}`;
  await api('/setup', { token: emp.token, username, password: PASSWORD }).expect(200);
  return { ...emp, username };
}

beforeAll(async () => {
  await users.doc(owner.id).set({
    role: 'owner',
    name: 'Test Owner',
    email: `owner-${run}@example.com`,
    phone: null,
    department: 'Test',
    title: '',
    status: 'active',
  });
});

beforeEach(async () => {
  sendEmail.mockClear();
  await redis.flushall();
});

afterAll(async () => {
  const ids = [owner.id, ...created];
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  const chunks = Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) =>
    ids.slice(i * 30, i * 30 + 30),
  );
  const queries = chunks.flatMap((chunk) => [
    ...['uniques', 'setupTokens', 'refreshTokens'].map((c) =>
      db.collection(c).where('userId', 'in', chunk),
    ),
    db.collection('activities').where('actorId', 'in', chunk),
  ]);
  for (const q of queries) for (const doc of (await q.get()).docs) batch.delete(doc.ref);
  for (let i = 1; i <= n; i++) batch.delete(codeRef('email', `onb-${run}-${i}@example.com`));
  await batch.commit();
});

describe('setup link', () => {
  it('check returns who the link is for', async () => {
    const emp = await invite();
    const res = await api('/setup/check', { token: emp.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: `Onboard ${n}`, email: emp.email });
  });

  it('rejects an unknown or malformed token', async () => {
    expect((await api('/setup/check', { token: 'x'.repeat(43) })).body.error.code).toBe(
      'LINK_INVALID',
    );
    expect((await api('/setup/check', { token: 'short' })).status).toBe(400);
  });

  it('activates the account, stores a bcrypt hash, and marks the link used', async () => {
    const emp = await invite();
    const res = await api('/setup', {
      token: emp.token,
      username: `Jane.${run}`,
      password: PASSWORD,
    });
    expect(res.body).toEqual({ success: true, username: `jane.${run}` }); // lowercased

    const user = (await users.doc(emp.id).get()).data()!;
    expect(user).toMatchObject({ status: 'active', username: `jane.${run}`, failedLogins: 0 });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(
      (await db.doc(`setupTokens/${hashSetupToken(emp.token)}`).get()).data()!.usedAt,
    ).not.toBeNull();
    const activity = await db.collection('activities').where('actorId', '==', emp.id).get();
    expect(activity.docs.map((d) => d.data().action)).toContain('employee.setup_completed');
  });

  it('rejects a reused setup token', async () => {
    const emp = await activeEmployee();
    const res = await api('/setup', {
      token: emp.token,
      username: `other-${run}`,
      password: PASSWORD,
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('LINK_USED');
  });

  it('rejects an expired setup token', async () => {
    const emp = await invite();
    await db
      .doc(`setupTokens/${hashSetupToken(emp.token)}`)
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    expect((await api('/setup/check', { token: emp.token })).body.error.code).toBe('LINK_EXPIRED');
    expect(
      (await api('/setup', { token: emp.token, username: `exp-${run}`, password: PASSWORD }))
        .status,
    ).toBe(410);
  });

  it('rejects a link replaced by a resent invite', async () => {
    const emp = await invite();
    await request(app)
      .post('/api/employee/resend-invite')
      .set(asOwner())
      .send({ employeeId: emp.id });
    expect((await api('/setup/check', { token: emp.token })).body.error.code).toBe('LINK_INVALID');
  });

  it('rejects a taken username, and leaves the link usable', async () => {
    const first = await activeEmployee();
    const emp = await invite();
    const res = await api('/setup', {
      token: emp.token,
      username: first.username,
      password: PASSWORD,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'username' }]);
    expect((await api('/setup/check', { token: emp.token })).status).toBe(200);
  });

  it('enforces username and password rules', async () => {
    const emp = await invite();
    const setup = (username: string, password: string) =>
      api('/setup', { token: emp.token, username, password });
    expect((await setup('ab', PASSWORD)).status).toBe(400);
    expect((await setup('has space', PASSWORD)).status).toBe(400);
    expect((await setup(`ok-${run}`, 'short')).status).toBe(400);
    expect((await setup(`ok-${run}`, 'é'.repeat(37))).status).toBe(400); // 74 bytes > bcrypt's 72
  });
});

describe('password login', () => {
  const login = (username: string, password: string) => api('/login', { username, password });

  it('signs in with username and password', async () => {
    const emp = await activeEmployee();
    const res = await login(emp.username.toUpperCase(), PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: emp.id, role: 'employee', username: emp.username });
    expect(verifyAccessToken(res.body.accessToken)).toEqual({ id: emp.id, role: 'employee' });
    expect(res.headers['set-cookie']?.[0]).toMatch(/^rt=/);
  });

  it('gives the same error for a wrong password and an unknown username', async () => {
    const emp = await activeEmployee();
    const wrong = await login(emp.username, 'nope-nope');
    const unknown = await login(`ghost-${run}`, PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks after 5 wrong passwords, even for the right one, then unlocks after 15 minutes', async () => {
    const emp = await activeEmployee();
    for (let i = 0; i < 4; i++) expect((await login(emp.username, 'nope-nope')).status).toBe(401);
    expect((await login(emp.username, 'nope-nope')).status).toBe(423);
    const res = await login(emp.username, PASSWORD);
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');

    await users.doc(emp.id).update({ lockedUntil: Timestamp.fromMillis(Date.now() - 1000) });
    expect((await login(emp.username, PASSWORD)).status).toBe(200);
    expect((await users.doc(emp.id).get()).data()).toMatchObject({
      failedLogins: 0,
      lockedUntil: null,
    });
  });

  it('a successful login resets the failure count', async () => {
    const emp = await activeEmployee();
    for (let i = 0; i < 3; i++) await login(emp.username, 'nope-nope');
    await login(emp.username, PASSWORD).expect(200);
    for (let i = 0; i < 4; i++) expect((await login(emp.username, 'nope-nope')).status).toBe(401);
  });

  it('sends no email code to employees who have not finished setup', async () => {
    const emp = await invite();
    sendEmail.mockClear(); // the invite itself was an email
    expect((await api('/LoginEmail', { email: emp.email })).body).toEqual({ success: true });
    expect(sendEmail).toHaveBeenCalledTimes(0);
  });
});

describe('email code login', () => {
  it('emails a code to an active employee and signs them in with it', async () => {
    const emp = await activeEmployee();
    sendEmail.mockClear();
    const sent = await api('/LoginEmail', { email: emp.email.toUpperCase() });
    expect(sent.body).toEqual({ success: true });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: emp.email }));

    const res = await api('/ValidateAccessCode', { email: emp.email, accessCode: lastEmailCode() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, user: { id: emp.id } });
    expect((await codeRef('email', emp.email).get()).data()!.codeHmac).toBe('');
  });

  it('answers the same for an unknown email and sends nothing', async () => {
    const res = await api('/LoginEmail', { email: `nobody-${run}@example.com` });
    expect(res.body).toEqual({ success: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('returns the code instead of emailing it for demo accounts', async () => {
    const emp = await activeEmployee();
    await users.doc(emp.id).update({ demo: true });
    sendEmail.mockClear();
    const res = await api('/LoginEmail', { email: emp.email });
    expect(res.body.accessCode).toMatch(/^\d{6}$/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a wrong or expired code', async () => {
    const emp = await activeEmployee();
    await api('/LoginEmail', { email: emp.email });
    const code = lastEmailCode();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect(
      (await api('/ValidateAccessCode', { email: emp.email, accessCode: wrong })).body.error.code,
    ).toBe('INVALID_CODE');
    await codeRef('email', emp.email).update({
      expiresAt: Timestamp.fromMillis(Date.now() - 1000),
    });
    expect(
      (await api('/ValidateAccessCode', { email: emp.email, accessCode: code })).body.error.code,
    ).toBe('CODE_EXPIRED');
  });

  it('does not let an owner sign in through the employee route', async () => {
    const res = await api('/LoginEmail', { email: `owner-${run}@example.com` });
    expect(res.body).toEqual({ success: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('after deletion', () => {
  it('frees the username and refuses both login methods', async () => {
    const emp = await activeEmployee();
    await request(app)
      .post('/api/DeleteEmployee')
      .set(asOwner())
      .send({ employeeId: emp.id })
      .expect(200);
    expect((await api('/login', { username: emp.username, password: PASSWORD })).status).toBe(401);
    expect((await db.doc(`uniques/username:${emp.username}`).get()).exists).toBe(false);
    sendEmail.mockClear(); // the invite itself was an email
    await api('/LoginEmail', { email: emp.email });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
