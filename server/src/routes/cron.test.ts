import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

// The reminder job against the real skipli-dev Firestore (Redis, SMS and email mocked), always with a 2001 clock.
// The HTTP endpoint is tested in cron-route.test.ts with the job stubbed out, so no test runs it at the real time.
type Email = { to: string; subject: string; text: string; html: string };
const sendEmail = jest.fn<(e: Email) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule('../lib/redis.js', () => ({ redis: new RedisMock() }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({ sendEmail, escapeHtml: (s: string) => s }));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { signAccessToken } = await import('../services/session.js');
const { sendDueReminders } = await import('../services/reminders.js');

const app = createApp();
const run = randomUUID().slice(0, 8);
const owner = { id: `c-owner-${run}`, role: 'owner' as const, name: 'Cron Owner' };
const ann = { id: `c-ann-${run}`, role: 'employee' as const, name: 'Ann' };
const users = db.collection('users');
const tasks = db.collection('tasks');
const notifications = db.collection('notifications');

// The job runs against the shared dev database, so these tests use a clock in 2001: only the tasks created
// here are due around then, and nobody else's dev tasks get reminders.
const NOW = Date.UTC(2001, 0, 15, 12);
const HOUR = 60 * 60 * 1000;
const at = (ms: number) => new Date(ms).toISOString();

const createTask = async (title: string, dueMs: number, assigneeId: string | null = ann.id) =>
  (
    await request(app)
      .post('/api/tasks')
      .set({ Authorization: `Bearer ${signAccessToken(owner)}` })
      .send({ title, assigneeId, dueDate: at(dueMs) })
  ).body as { id: string; version: number };
const remindersFor = async (taskId: string) =>
  (await notifications.where('payload.taskId', '==', taskId).get()).docs
    .map((d) => d.data().type)
    .filter((t) => t !== 'task.assigned');

beforeAll(async () => {
  for (const p of [owner, ann]) {
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
  const ids = [owner.id, ann.id];
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  for (const q of [
    tasks.where('createdBy', '==', owner.id),
    notifications.where('userId', 'in', ids),
    db.collection('activities').where('actorId', 'in', ids),
  ]) {
    for (const doc of (await q.get()).docs) batch.delete(doc.ref);
  }
  await batch.commit();
});

describe('sendDueReminders', () => {
  it('sends each owed reminder once, and only for open, assigned tasks', async () => {
    const soon = await createTask('Due in 2h', NOW + 2 * HOUR);
    const late = await createTask('An hour late', NOW - HOUR);
    const later = await createTask('Due in 3 days', NOW + 72 * HOUR);
    const unassigned = await createTask('Nobody', NOW - HOUR, null);
    const finished = await createTask('Finished late', NOW - HOUR);
    await request(app)
      .patch(`/api/tasks/${finished.id}`)
      .set({ Authorization: `Bearer ${signAccessToken(owner)}` })
      .send({ version: finished.version, status: 'done' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 300)); // let the "New task" assignment emails go out first
    sendEmail.mockClear();

    const first = await sendDueReminders(NOW);
    expect(first).toMatchObject({ dueSoon: 1, overdue: 1 });
    expect(await remindersFor(soon.id)).toEqual(['task.due_soon']);
    expect(await remindersFor(late.id)).toEqual(['task.overdue']);
    for (const t of [later, unassigned, finished]) expect(await remindersFor(t.id)).toEqual([]);
    // A task first seen overdue skips the due-soon reminder for good.
    expect((await tasks.doc(late.id).get()).data()!.reminderSentAt).not.toBeNull();

    // Assignee has no open tab here, so both also went out by email.
    expect(sendEmail.mock.calls.map(([e]) => e.subject).sort()).toEqual([
      'Due soon: Due in 2h',
      'Overdue: An hour late',
    ]);

    // Running again (a retry, an overlapping run) sends nothing new.
    sendEmail.mockClear();
    expect(await sendDueReminders(NOW)).toMatchObject({ dueSoon: 0, overdue: 0 });
    expect(sendEmail).not.toHaveBeenCalled();

    // Once the due-soon task passes its due time, it gets its overdue reminder too.
    await sendDueReminders(NOW + 3 * HOUR);
    expect((await remindersFor(soon.id)).sort()).toEqual(['task.due_soon', 'task.overdue']);
  });

  it('sends again after the due date is changed', async () => {
    const task = await createTask('Moved deadline', NOW + HOUR);
    await sendDueReminders(NOW);
    await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set({ Authorization: `Bearer ${signAccessToken(owner)}` })
      .send({ version: task.version, dueDate: at(NOW + 5 * HOUR) })
      .expect(200);
    await sendDueReminders(NOW);
    expect(await remindersFor(task.id)).toEqual(['task.due_soon', 'task.due_soon']);
  });

  it('does not touch the version, so open edit forms are not disturbed', async () => {
    const task = await createTask('Quiet update', NOW + HOUR);
    await sendDueReminders(NOW);
    expect((await tasks.doc(task.id).get()).data()!.version).toBe(task.version);
  });
});
