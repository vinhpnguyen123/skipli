import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import { io as connectSocket } from 'socket.io-client';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis, SMS and email are mocked.
process.env.DEMO_MODE = 'true';
type Email = { to: string; subject: string; text: string; html: string };
const sendEmail = jest.fn<(e: Email) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/redis.js', () => ({ redis: new RedisMock() }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({ sendEmail, escapeHtml: (s: string) => s }));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { initSocket } = await import('../socket/index.js');
const { issueRefreshToken, signAccessToken } = await import('../services/session.js');
const { hashSetupToken } = await import('../services/setup-token.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
const owner = { id: `test-owner-${run}`, role: 'owner' as const };
const coworker = { id: `test-coworker-${run}`, role: 'employee' as const };
const created: string[] = [];
let n = 0;
const uniqueEmail = () => `emp-${run}-${++n}@example.com`;
const uniquePhone = () => `+1555${String(Date.now() + n++).slice(-7)}`;

const bearer = (user: { id: string; role: 'owner' | 'employee' }) => ({
  Authorization: `Bearer ${signAccessToken(user)}`,
});
const asOwner = { Authorization: '' };
const post = (path: string, body: object, auth: Record<string, string> = asOwner) =>
  request(app).post(`/api${path}`).set(auth).send(body);
const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;
const users = db.collection('users');

async function create(body: Record<string, unknown> = {}) {
  const res = await post('/CreateEmployee', {
    name: 'Test Employee',
    email: uniqueEmail(),
    department: 'QA',
    ...body,
  });
  if (res.body.employeeId) created.push(res.body.employeeId);
  return res;
}

beforeAll(async () => {
  Object.assign(asOwner, bearer(owner));
  const base = { email: `${run}@example.com`, department: 'Test', title: '', status: 'active' };
  await users.doc(owner.id).set({ ...base, role: 'owner', name: 'Test Owner', phone: null });
  await users
    .doc(coworker.id)
    .set({
      ...base,
      role: 'employee',
      name: 'Coworker',
      email: `co-${run}@example.com`,
      phone: null,
    });
});

beforeEach(() => sendEmail.mockClear());

afterAll(async () => {
  const ids = [owner.id, coworker.id, ...created];
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  // Firestore's `in` takes at most 30 values.
  const chunks = Array.from({ length: Math.ceil(ids.length / 30) }, (_, i) =>
    ids.slice(i * 30, i * 30 + 30),
  );
  const queries = [
    ...chunks.flatMap((chunk) =>
      ['uniques', 'setupTokens', 'refreshTokens'].map((c) =>
        db.collection(c).where('userId', 'in', chunk),
      ),
    ),
    db.collection('activities').where('actorId', '==', owner.id),
  ];
  for (const q of queries) for (const doc of (await q.get()).docs) batch.delete(doc.ref);
  await batch.commit();
});

describe('CreateEmployee', () => {
  it('creates an invited employee, reserves the email, and emails a single-use setup link', async () => {
    const email = uniqueEmail();
    const res = await create({ email });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      inviteSent: true,
      setupUrl: expect.stringContaining('/setup?token='),
    });

    const user = (await users.doc(res.body.employeeId).get()).data()!;
    expect(user).toMatchObject({
      role: 'employee',
      status: 'invited',
      email,
      phone: null,
      title: '',
      passwordHash: null,
    });
    expect((await db.doc(`uniques/email:${email}`).get()).data()).toEqual({
      userId: res.body.employeeId,
    });

    const raw = tokenFrom(res.body.setupUrl);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, text: expect.stringContaining(raw) }),
    );
    expect((await db.doc(`setupTokens/${raw}`).get()).exists).toBe(false); // only the hash is stored
    const token = (await db.doc(`setupTokens/${hashSetupToken(raw)}`).get()).data()!;
    expect(token).toMatchObject({ userId: res.body.employeeId, usedAt: null });

    const activity = await db
      .collection('activities')
      .where('targetId', '==', res.body.employeeId)
      .get();
    expect(activity.docs.map((d) => d.data())).toEqual([
      expect.objectContaining({
        action: 'employee.created',
        actorName: 'Test Owner',
        targetName: 'Test Employee',
      }),
    ]);
  });

  it('accepts phone and title, and lowercases the email', async () => {
    const phone = uniquePhone();
    const res = await create({ email: `UPPER-${run}@Example.com`, phone, title: 'Tester' });
    const user = (await users.doc(res.body.employeeId).get()).data()!;
    expect(user).toMatchObject({ email: `upper-${run}@example.com`, phone, title: 'Tester' });
    expect((await db.doc(`uniques/phone:${phone}`).get()).exists).toBe(true);
  });

  it('rejects a duplicate email regardless of case', async () => {
    const email = uniqueEmail();
    await create({ email });
    const res = await create({ email: email.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: [{ path: 'email' }] });
  });

  it('rejects a duplicate phone', async () => {
    const phone = uniquePhone();
    await create({ phone });
    const res = await create({ phone });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'phone' }]);
  });

  it('rejects unknown fields such as role', async () => {
    const res = await create({ role: 'owner' });
    expect(res.status).toBe(400);
  });

  it('is owner-only', async () => {
    const res = await post(
      '/CreateEmployee',
      { name: 'X', email: uniqueEmail(), department: 'QA' },
      bearer(coworker),
    );
    expect(res.status).toBe(403);
  });

  it('still creates the employee when the email fails, and says so', async () => {
    sendEmail.mockRejectedValueOnce(new Error('resend down'));
    jest.spyOn(console, 'error').mockImplementationOnce(() => {});
    const res = await create();
    expect(res.status).toBe(200);
    expect(res.body.inviteSent).toBe(false);
    expect((await users.doc(res.body.employeeId).get()).exists).toBe(true);
  });
});

describe('GetEmployee and list', () => {
  it('returns the employee to the owner, without secrets', async () => {
    const { body } = await create();
    const res = await post('/GetEmployee', { employeeId: body.employeeId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: body.employeeId, status: 'invited' });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('lets an employee read themselves but not a coworker', async () => {
    const { body } = await create();
    expect((await post('/GetEmployee', { employeeId: coworker.id }, bearer(coworker))).status).toBe(
      200,
    );
    expect(
      (await post('/GetEmployee', { employeeId: body.employeeId }, bearer(coworker))).status,
    ).toBe(404);
  });

  it('returns 404 for unknown ids and for the owner', async () => {
    expect((await post('/GetEmployee', { employeeId: 'nope' })).status).toBe(404);
    expect((await post('/GetEmployee', { employeeId: owner.id })).status).toBe(404);
  });

  it('lists employees for the owner only', async () => {
    const { body } = await create();
    const res = await request(app).get('/api/employees').set(asOwner);
    expect(res.body.employees.map((e: { id: string }) => e.id)).toContain(body.employeeId);
    expect((await request(app).get('/api/employees').set(bearer(coworker))).status).toBe(403);
  });
});

describe('PATCH /employees/:id', () => {
  const patch = (id: string, body: object) =>
    request(app).patch(`/api/employees/${id}`).set(asOwner).send(body);

  it('updates fields and moves the email reservation', async () => {
    const oldEmail = uniqueEmail();
    const { body } = await create({ email: oldEmail });
    const newEmail = uniqueEmail();
    const res = await patch(body.employeeId, { email: newEmail, title: 'Lead' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: newEmail, title: 'Lead' });
    expect((await db.doc(`uniques/email:${oldEmail}`).get()).exists).toBe(false);
    expect((await create({ email: oldEmail })).status).toBe(200); // old address is free again
  });

  it('rejects an email another user already has', async () => {
    const taken = uniqueEmail();
    await create({ email: taken });
    const { body } = await create();
    expect((await patch(body.employeeId, { email: taken })).status).toBe(409);
  });

  it('clears the phone with null and frees it', async () => {
    const phone = uniquePhone();
    const { body } = await create({ phone });
    expect((await patch(body.employeeId, { phone: null })).body.phone).toBeNull();
    expect((await db.doc(`uniques/phone:${phone}`).get()).exists).toBe(false);
  });

  it('rejects an empty update and role changes', async () => {
    const { body } = await create();
    expect((await patch(body.employeeId, {})).status).toBe(400);
    expect((await patch(body.employeeId, { role: 'owner' })).status).toBe(400);
  });
});

describe('DeleteEmployee', () => {
  // An employee who finished onboarding and is signed in.
  async function signedInEmployee() {
    const email = uniqueEmail();
    const { body } = await create({ email });
    await users.doc(body.employeeId).update({ status: 'active' });
    const refresh = await issueRefreshToken(body.employeeId);
    return {
      id: body.employeeId as string,
      email,
      auth: bearer({ id: body.employeeId, role: 'employee' }),
      refresh,
    };
  }

  it('removes the employee and everything that could let them back in', async () => {
    const emp = await signedInEmployee();
    expect((await post('/GetEmployee', { employeeId: emp.id }, emp.auth)).status).toBe(200);

    expect((await post('/DeleteEmployee', { employeeId: emp.id })).body).toEqual({ success: true });

    expect((await users.doc(emp.id).get()).exists).toBe(false);
    expect((await db.doc(`uniques/email:${emp.email}`).get()).exists).toBe(false);
    for (const c of ['setupTokens', 'refreshTokens']) {
      expect((await db.collection(c).where('userId', '==', emp.id).get()).size).toBe(0);
    }
    // Their still-unexpired access token and refresh cookie are both refused.
    const res = await post('/GetEmployee', { employeeId: emp.id }, emp.auth);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Account unavailable');
    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('X-Requested-With', 'skipli')
      .set('Cookie', `rt=${emp.refresh}`);
    expect(refreshed.status).toBe(401);

    const activity = await db.collection('activities').where('targetId', '==', emp.id).get();
    expect(activity.docs.map((d) => d.data())).toContainEqual(
      expect.objectContaining({ action: 'employee.deleted', targetName: 'Test Employee' }),
    );
  });

  it('disconnects their open sockets and refuses reconnects', async () => {
    const emp = await signedInEmployee();
    const server = createServer(app);
    initSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
    const token = emp.auth.Authorization.slice('Bearer '.length);
    const socket = connectSocket(url, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
      });
      const dropped = new Promise<string>((r) => socket.on('disconnect', r));
      await post('/DeleteEmployee', { employeeId: emp.id });
      expect(await dropped).toBe('io server disconnect');

      const retry = new Promise<string>((r) => socket.once('connect_error', (e) => r(e.message)));
      socket.connect();
      expect(await retry).toBe('Account unavailable');
    } finally {
      socket.close();
      await new Promise((r) => server.close(r));
    }
  });

  it('returns 404 for an unknown employee and 403 for non-owners', async () => {
    expect((await post('/DeleteEmployee', { employeeId: 'nope' })).status).toBe(404);
    expect(
      (await post('/DeleteEmployee', { employeeId: coworker.id }, bearer(coworker))).status,
    ).toBe(403);
  });
});

describe('resend-invite', () => {
  it('replaces the setup link, so only the newest one works', async () => {
    const { body } = await create();
    const first = tokenFrom(body.setupUrl);
    const res = await post('/employee/resend-invite', { employeeId: body.employeeId });
    expect(res.body).toMatchObject({ success: true, inviteSent: true });
    const second = tokenFrom(res.body.setupUrl);
    expect(second).not.toBe(first);
    expect((await db.doc(`setupTokens/${hashSetupToken(first)}`).get()).exists).toBe(false);
    expect((await db.doc(`setupTokens/${hashSetupToken(second)}`).get()).exists).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('refuses employees who already set up their account', async () => {
    const res = await post('/employee/resend-invite', { employeeId: coworker.id });
    expect(res.status).toBe(409);
  });
});
