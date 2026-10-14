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
  sendEmail: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  escapeHtml: (s: string) => s,
}));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { initSocket } = await import('../socket/index.js');
const { signAccessToken } = await import('../services/session.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
type Person = { id: string; role: 'owner' | 'employee'; name: string };
const owner: Person = { id: `t-owner-${run}`, role: 'owner', name: 'Task Owner' };
const ann: Person = { id: `t-ann-${run}`, role: 'employee', name: 'Ann' };
const bob: Person = { id: `t-bob-${run}`, role: 'employee', name: 'Bob' };
const people = [owner, ann, bob];
const users = db.collection('users');
const tasks = db.collection('tasks');

const auth = (p: Person) => ({ Authorization: `Bearer ${signAccessToken(p)}` });
const create = (body: object, as = owner) =>
  request(app).post('/api/tasks').set(auth(as)).send(body);
const patch = (id: string, body: object, as = owner) =>
  request(app).patch(`/api/tasks/${id}`).set(auth(as)).send(body);
const list = (as: Person, query = '') => request(app).get(`/api/tasks${query}`).set(auth(as));
const activitiesFor = async (taskId: string) =>
  (await db.collection('activities').where('targetId', '==', taskId).get()).docs.map(
    (d) => d.data().action,
  );

async function addPerson(p: Person) {
  await users.doc(p.id).set({
    role: p.role,
    name: p.name,
    email: `${p.id}@example.com`,
    phone: null,
    department: 'QA',
    title: '',
    username: null,
    status: 'active',
  });
}

beforeAll(async () => {
  for (const p of people) await addPerson(p);
});

afterAll(async () => {
  const ids = people.map((p) => p.id);
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  for (const q of [
    tasks.where('createdBy', '==', owner.id),
    db.collection('activities').where('actorId', 'in', ids),
  ]) {
    for (const doc of (await q.get()).docs) batch.delete(doc.ref);
  }
  await batch.commit();
});

describe('creating tasks', () => {
  it('creates a todo task at version 1 and logs it', async () => {
    const res = await create({
      title: '  Write report ',
      assigneeId: ann.id,
      dueDate: '2030-01-02T17:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Write report',
      description: '',
      assigneeId: ann.id,
      status: 'todo',
      version: 1,
      dueDate: '2030-01-02T17:00:00.000Z',
    });
    expect(await activitiesFor(res.body.id)).toEqual(['task.created']);
  });

  it('allows unassigned tasks', async () => {
    const res = await create({ title: 'Someone should do this' });
    expect(res.body.assigneeId).toBeNull();
  });

  it('rejects an assignee who is not an employee', async () => {
    for (const assigneeId of [`ghost-${run}`, owner.id]) {
      const res = await create({ title: 'X', assigneeId });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({ path: 'assigneeId' });
    }
  });

  it('rejects unknown fields and non-owners', async () => {
    expect((await create({ title: 'X', version: 5 })).status).toBe(400);
    expect((await create({ title: 'X' }, ann)).status).toBe(403);
  });
});

describe('listing tasks', () => {
  it('shows employees only their own tasks, and lets the owner filter', async () => {
    const mine = (await create({ title: 'For Ann', assigneeId: ann.id })).body;
    const other = (await create({ title: 'For Bob', assigneeId: bob.id })).body;
    const open = (await create({ title: 'Nobody yet' })).body;
    const ids = (res: request.Response) => res.body.tasks.map((t: { id: string }) => t.id);

    const annSees = ids(await list(ann));
    expect(annSees).toContain(mine.id);
    expect(annSees).not.toContain(other.id);
    expect(ids(await list(owner))).toEqual(expect.arrayContaining([mine.id, other.id, open.id]));
    expect(ids(await list(owner, `?assigneeId=${bob.id}`))).toEqual(
      expect.arrayContaining([other.id]),
    );
    expect(ids(await list(owner, `?assigneeId=${bob.id}`))).not.toContain(mine.id);
    expect(ids(await list(owner, '?assigneeId=none'))).toContain(open.id);
  });
});

describe('updating tasks', () => {
  it('lets the assignee move their task and logs it as moved, then completed', async () => {
    const task = (await create({ title: 'Move me', assigneeId: ann.id })).body;
    const moved = await patch(task.id, { version: 1, status: 'in_progress' }, ann);
    expect(moved.body).toMatchObject({ status: 'in_progress', version: 2 });
    await patch(task.id, { version: 2, status: 'done', order: 5 }, ann).expect(200);
    expect(await activitiesFor(task.id)).toEqual(
      expect.arrayContaining(['task.moved', 'task.completed']),
    );
  });

  it('lets an employee move a task back out of Done', async () => {
    const task = (await create({ title: 'Oops', assigneeId: ann.id })).body;
    await patch(task.id, { version: 1, status: 'done' }, ann).expect(200);
    expect((await patch(task.id, { version: 2, status: 'todo' }, ann)).body.status).toBe('todo');
  });

  it('does not log a reorder within a column', async () => {
    const task = (await create({ title: 'Reorder me', assigneeId: ann.id })).body;
    await patch(task.id, { version: 1, order: 1.5 }, ann).expect(200);
    expect(await activitiesFor(task.id)).toEqual(['task.created']);
  });

  it('refuses other fields from an employee', async () => {
    const task = (await create({ title: 'Locked title', assigneeId: ann.id })).body;
    for (const body of [{ title: 'Mine now' }, { assigneeId: bob.id }, { dueDate: null }]) {
      expect((await patch(task.id, { version: 1, ...body }, ann)).status).toBe(403);
    }
  });

  it("hides other employees' tasks behind 404", async () => {
    const task = (await create({ title: "Ann's", assigneeId: ann.id })).body;
    expect((await patch(task.id, { version: 1, status: 'done' }, bob)).status).toBe(404);
  });

  it('returns 409 with the latest task when the version is stale', async () => {
    const task = (await create({ title: 'Contested', assigneeId: ann.id })).body;
    await patch(task.id, { version: 1, title: 'Owner edit' }).expect(200);
    const res = await patch(task.id, { version: 1, status: 'done' }, ann);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
    expect(res.body.error.details.task).toMatchObject({
      title: 'Owner edit',
      version: 2,
      status: 'todo',
    });
  });

  it('reassigns, after which the old assignee can no longer touch it', async () => {
    const task = (await create({ title: 'Hand over', assigneeId: ann.id })).body;
    await patch(task.id, { version: 1, assigneeId: bob.id }).expect(200);
    expect((await patch(task.id, { version: 2, status: 'done' }, ann)).status).toBe(404);
    expect(await activitiesFor(task.id)).toContain('task.assigned');
  });

  it('clears sent reminders when the due date changes', async () => {
    const task = (
      await create({ title: 'Due', assigneeId: ann.id, dueDate: '2030-01-01T00:00:00Z' })
    ).body;
    await tasks.doc(task.id).update({ reminderSentAt: new Date(), overdueNotifiedAt: new Date() });
    await patch(task.id, { version: 1, dueDate: '2030-02-01T00:00:00Z' }).expect(200);
    expect((await tasks.doc(task.id).get()).data()).toMatchObject({
      reminderSentAt: null,
      overdueNotifiedAt: null,
    });
  });

  it('rejects an update with only a version', async () => {
    const task = (await create({ title: 'Nothing' })).body;
    expect((await patch(task.id, { version: 1 })).status).toBe(400);
  });
});

describe('deleting', () => {
  it('lets only the owner delete', async () => {
    const task = (await create({ title: 'Delete me', assigneeId: ann.id })).body;
    expect((await request(app).delete(`/api/tasks/${task.id}`).set(auth(ann))).status).toBe(403);
    await request(app).delete(`/api/tasks/${task.id}`).set(auth(owner)).expect(200);
    expect((await tasks.doc(task.id).get()).exists).toBe(false);
    expect((await request(app).delete(`/api/tasks/${task.id}`).set(auth(owner))).status).toBe(404);
  });

  it("unassigns a deleted employee's open tasks and keeps their done ones", async () => {
    const cat: Person = { id: `t-cat-${run}`, role: 'employee', name: 'Cat' };
    await addPerson(cat);
    const open = (await create({ title: 'Open', assigneeId: cat.id })).body;
    const done = (await create({ title: 'Finished', assigneeId: cat.id })).body;
    await patch(done.id, { version: 1, status: 'done' }).expect(200);

    await request(app)
      .post('/api/DeleteEmployee')
      .set(auth(owner))
      .send({ employeeId: cat.id })
      .expect(200);
    expect((await tasks.doc(open.id).get()).data()).toMatchObject({ assigneeId: null, version: 2 });
    expect((await tasks.doc(done.id).get()).data()).toMatchObject({ assigneeId: cat.id });
  });
});

describe('realtime', () => {
  let server: Server;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    server = createServer(app);
    initSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await new Promise((r) => server.close(r));
  });

  async function socketFor(p: Person) {
    const s = connect(url, {
      transports: ['websocket'],
      auth: { token: signAccessToken(p) },
      reconnection: false,
    });
    sockets.push(s);
    await new Promise<void>((resolve, reject) => {
      s.on('connect', resolve);
      s.on('connect_error', reject);
    });
    // Collects every event so tests can check who got what.
    const events: [string, { id: string; assigneeId?: string | null }][] = [];
    s.onAny((event, data) => events.push([event, data]));
    return events;
  }
  const settle = () => new Promise((r) => setTimeout(r, 400));
  const about = (events: [string, { id: string }][], id: string) =>
    events.filter(([, d]) => d.id === id).map(([e]) => e);

  it('tells the owner and the assignee, and nobody else', async () => {
    const [ownerEvents, annEvents, bobEvents] = [
      await socketFor(owner),
      await socketFor(ann),
      await socketFor(bob),
    ];

    const task = (await create({ title: 'Live', assigneeId: ann.id })).body;
    await patch(task.id, { version: 1, status: 'in_progress' }, ann).expect(200);
    await settle();
    expect(about(ownerEvents, task.id)).toEqual(['task:created', 'task:updated']);
    expect(about(annEvents, task.id)).toEqual(['task:created', 'task:updated']);
    expect(about(bobEvents, task.id)).toEqual([]);

    // Reassigning tells both the old and the new assignee; deleting tells the current one.
    await patch(task.id, { version: 2, assigneeId: bob.id }).expect(200);
    await request(app).delete(`/api/tasks/${task.id}`).set(auth(owner)).expect(200);
    await settle();
    expect(about(annEvents, task.id)).toEqual(['task:created', 'task:updated', 'task:updated']);
    expect(about(bobEvents, task.id)).toEqual(['task:updated', 'task:deleted']);
    expect(about(ownerEvents, task.id)).toEqual([
      'task:created',
      'task:updated',
      'task:updated',
      'task:deleted',
    ]);
  });

  it('sends nothing when the change is rejected', async () => {
    const [annEvents] = [await socketFor(ann)];
    const task = (await create({ title: 'Conflict', assigneeId: ann.id })).body;
    await settle();
    const before = annEvents.length;
    await patch(task.id, { version: 99, status: 'done' }, ann).expect(409);
    await settle();
    expect(annEvents.length).toBe(before);
  });
});
