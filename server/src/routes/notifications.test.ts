import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis, SMS and email are mocked.
type Email = { to: string; subject: string; text: string; html: string };
const sendEmail = jest.fn<(e: Email) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/redis.js', () => ({ redis: new RedisMock() }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({ sendEmail, escapeHtml: (s: string) => s }));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { initSocket } = await import('../socket/index.js');
const { signAccessToken } = await import('../services/session.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
type Person = { id: string; role: 'owner' | 'employee'; name: string };
const owner: Person = { id: `n-owner-${run}`, role: 'owner', name: 'Notify Owner' };
const ann: Person = { id: `n-ann-${run}`, role: 'employee', name: 'Ann' };
const bob: Person = { id: `n-bob-${run}`, role: 'employee', name: 'Bob' };
const people = [owner, ann, bob];
const users = db.collection('users');
const notifications = db.collection('notifications');

const auth = (p: Person) => ({ Authorization: `Bearer ${signAccessToken(p)}` });
const createTask = (body: object) => request(app).post('/api/tasks').set(auth(owner)).send(body);
const patchTask = (id: string, body: object, as = owner) =>
  request(app).patch(`/api/tasks/${id}`).set(auth(as)).send(body);
const listFor = (p: Person) => request(app).get('/api/notifications').set(auth(p));
const markRead = (p: Person, body: object) =>
  request(app).patch('/api/notifications/read').set(auth(p)).send(body);
const notificationsAbout = async (taskId: string) =>
  (await notifications.where('payload.taskId', '==', taskId).get()).docs.map((d) => d.data());
// Emails go out after the response.
// For things that must happen in the background: retries the assertion until it passes (or 5 s go by),
// so a slow Firestore read under parallel test load doesn't fail a fixed sleep.
async function eventually(assertion: () => void, ms = 5000) {
  for (const start = Date.now(); ; await new Promise((r) => setTimeout(r, 50))) {
    try {
      return assertion();
    } catch (err) {
      if (Date.now() - start > ms) throw err;
    }
  }
}

beforeAll(async () => {
  for (const p of people) {
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
});

beforeEach(() => sendEmail.mockClear());

afterAll(async () => {
  const ids = people.map((p) => p.id);
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  for (const q of [
    db.collection('tasks').where('createdBy', '==', owner.id),
    notifications.where('userId', 'in', ids),
    db.collection('activities').where('actorId', 'in', ids),
  ]) {
    for (const doc of (await q.get()).docs) batch.delete(doc.ref);
  }
  await batch.commit();
});

describe('notifications on assignment', () => {
  it('notifies the assignee of a new task, and only them', async () => {
    const task = (await createTask({ title: 'Assigned at birth', assigneeId: ann.id })).body;
    expect(await notificationsAbout(task.id)).toEqual([
      expect.objectContaining({
        userId: ann.id,
        type: 'task.assigned',
        read: false,
        payload: { taskId: task.id, title: 'Assigned at birth', by: 'Notify Owner', dueDate: null },
      }),
    ]);
  });

  it('does not notify for unassigned tasks, moves, or unassigning', async () => {
    const open = (await createTask({ title: 'Nobody' })).body;
    expect(await notificationsAbout(open.id)).toEqual([]);

    const task = (await createTask({ title: 'Moves', assigneeId: ann.id })).body;
    await patchTask(task.id, { version: 1, status: 'done' }, ann).expect(200);
    await patchTask(task.id, { version: 2, assigneeId: null }).expect(200);
    expect(await notificationsAbout(task.id)).toHaveLength(1); // just the original assignment
  });

  it('notifies the new assignee on reassignment', async () => {
    const task = (await createTask({ title: 'Hand over', assigneeId: ann.id })).body;
    await patchTask(task.id, { version: 1, assigneeId: bob.id }).expect(200);
    expect((await notificationsAbout(task.id)).map((n) => n.userId).sort()).toEqual(
      [ann.id, bob.id].sort(),
    );
  });
});

describe('email when offline', () => {
  it('emails an assignee with no open connection, with the due date in the business time zone', async () => {
    await createTask({
      title: 'Email me',
      assigneeId: ann.id,
      dueDate: '2030-01-02T17:00:00Z',
    }).expect(201);
    await eventually(() =>
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: `${ann.id}@example.com`,
          subject: 'New task: Email me',
          text: expect.stringContaining('Due Jan 2, 2030, 12:00 PM EST'),
        }),
      ),
    );
  });

  it('still succeeds when the email fails', async () => {
    sendEmail.mockRejectedValueOnce(new Error('resend down'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await createTask({
      title: 'Email breaks',
      assigneeId: ann.id,
      dueDate: '2030-01-02T17:00:00Z',
    });
    expect(res.status).toBe(201);
    await eventually(() => expect(err).toHaveBeenCalled());
    err.mockRestore();
  });
});

describe('listing and marking read', () => {
  it("lists only the caller's notifications, newest first, with an unread count", async () => {
    const t1 = (await createTask({ title: 'First for Bob', assigneeId: bob.id })).body;
    const t2 = (await createTask({ title: 'Second for Bob', assigneeId: bob.id })).body;
    const res = await listFor(bob);
    expect(res.status).toBe(200);
    const mine = res.body.notifications.map(
      (n: { payload: { taskId: string } }) => n.payload.taskId,
    );
    expect(mine.indexOf(t2.id)).toBeLessThan(mine.indexOf(t1.id));
    expect(res.body.notifications.every((n: { type: string }) => n.type === 'task.assigned')).toBe(
      true,
    );
    expect(res.body.unreadCount).toBeGreaterThanOrEqual(2);
    expect((await listFor(owner)).body).toEqual({ notifications: [], unreadCount: 0 });
  });

  it("marks chosen ones read and ignores other people's ids", async () => {
    const mineTask = (await createTask({ title: 'Read me', assigneeId: bob.id })).body;
    const annTask = (await createTask({ title: 'Not yours', assigneeId: ann.id })).body;
    const [mine] = await notifications
      .where('payload.taskId', '==', mineTask.id)
      .get()
      .then((s) => s.docs);
    const [annsOne] = await notifications
      .where('payload.taskId', '==', annTask.id)
      .get()
      .then((s) => s.docs);

    const res = await markRead(bob, { ids: [mine.id, annsOne.id] });
    expect(res.body).toEqual({ success: true, ids: [mine.id] });
    expect((await mine.ref.get()).data()!.read).toBe(true);
    expect((await annsOne.ref.get()).data()!.read).toBe(false);
  });

  it('marks everything read', async () => {
    await createTask({ title: 'One more', assigneeId: bob.id });
    await markRead(bob, { all: true }).expect(200);
    expect((await listFor(bob)).body.unreadCount).toBe(0);
  });

  it('validates the body', async () => {
    for (const body of [{}, { all: false }, { ids: [] }, { ids: ['x'], all: true }]) {
      expect((await markRead(bob, body)).status).toBe(400);
    }
  });
});

describe('realtime', () => {
  let server: Server;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    server = createServer(app);
    initSocket(server);
    await new Promise<void>((r) => server.listen(0, r));
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await new Promise((r) => server.close(r));
  });

  async function tab(p: Person) {
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
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
    const events: [string, unknown][] = [];
    s.onAny((event, data) => events.push([event, data]));
    return events;
  }

  it('pushes the notification to an online assignee instead of emailing, and syncs reads across tabs', async () => {
    const [tab1, tab2] = [await tab(ann), await tab(ann)];
    const task = (await createTask({ title: 'Live one', assigneeId: ann.id })).body;
    await eventually(() => expect(tab1.map(([e]) => e)).toContain('notification:new'));
    const pushed = tab1.find(([e]) => e === 'notification:new')?.[1] as {
      id: string;
      payload: { taskId: string };
    };
    expect(pushed.payload.taskId).toBe(task.id);
    expect(sendEmail).not.toHaveBeenCalled();

    await markRead(ann, { ids: [pushed.id] }).expect(200);
    await eventually(() =>
      expect(tab2).toContainEqual(['notification:read', { ids: [pushed.id] }]),
    );
  });
});
