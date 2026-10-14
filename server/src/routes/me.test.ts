import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis, SMS and email are mocked.
jest.unstable_mockModule('../lib/redis.js', () => ({ redis: new RedisMock() }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({
  sendEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  escapeHtml: (s: string) => s,
}));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { signAccessToken } = await import('../services/session.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
const users = db.collection('users');
const uniques = db.collection('uniques');
let n = 0;
const phone = () => `+1555${String(Date.now() + n++).slice(-7)}`;

type Person = { id: string; role: 'owner' | 'employee'; email: string; phone: string };
const people: Person[] = [];

// A signed-in user with their email/phone reserved, as the API would have left them.
async function person(role: Person['role']): Promise<Person> {
  const p = {
    id: `test-${role}-${run}-${++n}`,
    role,
    email: `me-${run}-${n}@example.com`,
    phone: phone(),
  };
  await users.doc(p.id).set({
    role,
    name: `Person ${n}`,
    email: p.email,
    phone: p.phone,
    department: 'QA',
    title: 'Tester',
    username: null,
    status: 'active',
  });
  await uniques.doc(`email:${p.email}`).set({ userId: p.id });
  await uniques.doc(`phone:${p.phone}`).set({ userId: p.id });
  people.push(p);
  return p;
}

const auth = (p: Person) => ({ Authorization: `Bearer ${signAccessToken(p)}` });
const patchMe = (p: Person, body: object) => request(app).patch('/api/me').set(auth(p)).send(body);

afterAll(async () => {
  const ids = people.map((p) => p.id);
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  for (const q of [
    uniques.where('userId', 'in', ids),
    db.collection('activities').where('actorId', 'in', ids),
  ]) {
    for (const doc of (await q.get()).docs) batch.delete(doc.ref);
  }
  await batch.commit();
});

describe('GET /me', () => {
  it('returns the signed-in user without secrets', async () => {
    const p = await person('employee');
    const res = await request(app).get('/api/me').set(auth(p));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: p.id,
      role: 'employee',
      email: p.email,
      department: 'QA',
    });
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('requires a token', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
  });
});

describe('PATCH /me', () => {
  it('updates name, email and phone, and moves the reservations', async () => {
    const p = await person('employee');
    const email = `new-${run}-${n}@example.com`;
    const newPhone = phone();
    const res = await patchMe(p, { name: 'Renamed', email: email.toUpperCase(), phone: newPhone });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed', email, phone: newPhone });

    expect((await uniques.doc(`email:${p.email}`).get()).exists).toBe(false);
    expect((await uniques.doc(`email:${email}`).get()).data()).toEqual({ userId: p.id });
    expect((await uniques.doc(`phone:${p.phone}`).get()).exists).toBe(false);
    const activity = await db.collection('activities').where('actorId', '==', p.id).get();
    expect(activity.docs.map((d) => d.data())).toContainEqual(
      expect.objectContaining({
        action: 'profile.updated',
        metadata: { fields: ['name', 'email', 'phone'] },
      }),
    );
  });

  it('rejects fields only the owner may change', async () => {
    const p = await person('employee');
    for (const body of [
      { role: 'owner' },
      { department: 'Sales' },
      { title: 'CEO' },
      { status: 'active' },
      { username: 'x' },
    ]) {
      expect((await patchMe(p, body)).status).toBe(400);
    }
    expect((await users.doc(p.id).get()).data()).toMatchObject({
      role: 'employee',
      department: 'QA',
      title: 'Tester',
    });
  });

  it('rejects an email or phone someone else uses', async () => {
    const [a, b] = [await person('employee'), await person('employee')];
    const res = await patchMe(a, { email: b.email });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ path: 'email' }]);
    expect((await patchMe(a, { phone: b.phone })).status).toBe(409);
  });

  it('lets an employee clear their phone but not the owner', async () => {
    const emp = await person('employee');
    expect((await patchMe(emp, { phone: null })).body.phone).toBeNull();
    expect((await uniques.doc(`phone:${emp.phone}`).get()).exists).toBe(false);

    const owner = await person('owner');
    const res = await patchMe(owner, { phone: null });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'phone' });
  });

  it('rejects an empty update', async () => {
    const p = await person('employee');
    expect((await patchMe(p, {})).status).toBe(400);
  });

  it('only ever changes the caller', async () => {
    const [a, b] = [await person('employee'), await person('employee')];
    await patchMe(a, { name: 'Only A' }).expect(200);
    expect((await users.doc(b.id).get()).data()!.name).not.toBe('Only A');
  });
});
