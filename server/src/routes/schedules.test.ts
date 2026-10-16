import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis, SMS and email are mocked.
jest.unstable_mockModule('../lib/redis.js', () => ({ redis: new RedisMock() }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({
  sendEmail: jest.fn(),
  escapeHtml: (s: string) => s,
}));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { initSocket } = await import('../socket/index.js');
const { signAccessToken } = await import('../services/session.js');
const { normalizeShifts } = await import('../schemas/schedules.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
type Person = { id: string; role: 'owner' | 'employee'; name: string };
const owner: Person = { id: `s-owner-${run}`, role: 'owner', name: 'Schedule Owner' };
const ann: Person = { id: `s-ann-${run}`, role: 'employee', name: 'Ann' };
const bob: Person = { id: `s-bob-${run}`, role: 'employee', name: 'Bob' };
const people = [owner, ann, bob];
const users = db.collection('users');

const auth = (p: Person) => ({ Authorization: `Bearer ${signAccessToken(p)}` });
const put = (id: string, shifts: object[], as = owner) =>
  request(app).put(`/api/employees/${id}/schedule`).set(auth(as)).send({ shifts });
const get = (path: string, as = owner) => request(app).get(`/api${path}`).set(auth(as));
const shift = (dayOfWeek: number, start: string, end: string) => ({ dayOfWeek, start, end });

beforeAll(async () => {
  for (const p of people) {
    await users.doc(p.id).set({
      role: p.role,
      name: p.name,
      email: `${p.id}@example.com`,
      phone: null,
      department: 'QA',
      title: '',
      status: 'active',
    });
  }
});

afterAll(async () => {
  const ids = people.map((p) => p.id);
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  for (const id of ids) batch.delete(db.collection('schedules').doc(id));
  for (const doc of (await db.collection('activities').where('actorId', 'in', ids).get()).docs)
    batch.delete(doc.ref);
  await batch.commit();
});

describe('normalizeShifts', () => {
  it('splits overnight shifts at midnight and wraps Saturday into Sunday', () => {
    expect(normalizeShifts([shift(6, '22:00', '06:00'), shift(1, '09:00', '17:00')])).toEqual([
      shift(0, '00:00', '06:00'),
      shift(1, '09:00', '17:00'),
      shift(6, '22:00', '24:00'),
    ]);
  });

  it('keeps a shift ending at midnight in one piece', () => {
    expect(normalizeShifts([shift(2, '18:00', '00:00')])).toEqual([shift(2, '18:00', '24:00')]);
  });
});

describe('PUT /employees/:id/schedule', () => {
  it('stores the week split and sorted, and returns it with the time zone', async () => {
    const res = await put(ann.id, [shift(3, '13:00', '17:00'), shift(3, '20:00', '02:00')]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      employeeId: ann.id,
      shifts: [shift(3, '13:00', '17:00'), shift(3, '20:00', '24:00'), shift(4, '00:00', '02:00')],
      timeZone: expect.any(String),
    });
  });

  it('accepts the stored week sent back with a change (overnight halves end at 24:00)', async () => {
    const stored = (await put(ann.id, [shift(5, '22:00', '06:00')])).body.shifts;
    const res = await put(ann.id, [...stored, shift(1, '09:00', '17:00')]);
    expect(res.status).toBe(200);
    expect(res.body.shifts).toEqual([
      shift(1, '09:00', '17:00'),
      shift(5, '22:00', '24:00'),
      shift(6, '00:00', '06:00'),
    ]);
    expect((await put(ann.id, [shift(1, '24:00', '06:00')])).status).toBe(400);
  });

  it('rejects overlapping shifts, including an overnight tail running into the next day', async () => {
    expect(
      (await put(ann.id, [shift(1, '09:00', '13:00'), shift(1, '12:00', '15:00')])).status,
    ).toBe(400);
    const res = await put(ann.id, [shift(1, '22:00', '08:00'), shift(2, '07:00', '12:00')]);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toBe('Shifts overlap');
  });

  it('rejects zero-length shifts, bad times, and unknown fields', async () => {
    expect((await put(ann.id, [shift(1, '09:00', '09:00')])).status).toBe(400);
    expect((await put(ann.id, [shift(1, '9:00', '17:00')])).status).toBe(400);
    expect((await put(ann.id, [shift(7, '09:00', '17:00')])).status).toBe(400);
    expect((await put(ann.id, [{ ...shift(1, '09:00', '17:00'), note: 'x' }])).status).toBe(400);
  });

  it('is owner-only and 404s for non-employees', async () => {
    expect((await put(ann.id, [], ann)).status).toBe(403);
    expect((await put(owner.id, [])).status).toBe(404);
    expect((await put(`nobody-${run}`, [])).status).toBe(404);
  });
});

describe('reading schedules', () => {
  beforeAll(async () => {
    await put(ann.id, [shift(1, '09:00', '17:00')]);
  });

  it('lets an employee read their own schedule but not a coworker', async () => {
    expect((await get(`/employees/${ann.id}/schedule`, ann)).body.shifts).toEqual([
      shift(1, '09:00', '17:00'),
    ]);
    expect((await get(`/employees/${ann.id}/schedule`, bob)).status).toBe(404);
  });

  it('lists every employee for the owner (empty schedules included), only your own for an employee', async () => {
    const all = (await get('/schedules')).body.schedules as {
      employeeId: string;
      shifts: object[];
    }[];
    expect(all).toContainEqual(expect.objectContaining({ employeeId: bob.id, shifts: [] }));
    expect(all.find((s) => s.employeeId === ann.id)?.shifts).toHaveLength(1);
    const own = (await get('/schedules', bob)).body.schedules;
    expect(own.map((s: { employeeId: string }) => s.employeeId)).toEqual([bob.id]);
  });
});

describe('activity', () => {
  let server: Server;
  let socket: Socket;

  beforeAll(async () => {
    server = createServer(app);
    initSocket(server, { multiInstance: false });
    await new Promise<void>((r) => server.listen(0, r));
    socket = connect(`http://localhost:${(server.address() as AddressInfo).port}`, {
      transports: ['websocket'],
      auth: { token: signAccessToken(owner) },
    });
    await new Promise<void>((r) => socket.on('connect', () => r()));
  });

  afterAll(async () => {
    socket.disconnect();
    await new Promise((r) => server.close(r));
  });

  it('streams schedule changes and the feed entry to the owner', async () => {
    const activity = new Promise<{ action: string; targetName: string }>((r) =>
      socket.once('activity:new', r),
    );
    const schedule = new Promise<{ employeeId: string }>((r) => socket.once('schedule:updated', r));
    await put(bob.id, [shift(5, '10:00', '14:00')]);
    expect(await activity).toMatchObject({ action: 'schedule.updated', targetName: 'Bob' });
    expect(await schedule).toMatchObject({ employeeId: bob.id });
  });

  it('pages the log newest first with a cursor, owner only', async () => {
    const first = await get('/activities?visibility=feed&limit=1');
    expect(first.status).toBe(200);
    expect(first.body.activities).toHaveLength(1);
    const second = await get(`/activities?visibility=feed&limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.activities[0].id).not.toBe(first.body.activities[0].id);
    expect(second.body.activities[0].createdAt <= first.body.activities[0].createdAt).toBe(true);

    const feed = (await get('/activities?visibility=feed&limit=100')).body.activities;
    expect(feed).toContainEqual(
      expect.objectContaining({ actorId: owner.id, action: 'schedule.updated' }),
    );
    expect((await get('/activities', ann)).status).toBe(403);
    expect((await get('/activities?visibility=secret')).status).toBe(400);
  });
});
