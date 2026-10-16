import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import request from 'supertest';

// Wiring check for every protected route: no token → 401, employee on an owner route → 403. The routes'
// own suites cover what each does once allowed in; this one makes sure no route forgot its guard.
jest.unstable_mockModule('../lib/redis.js', () => ({ redis: new RedisMock() }));
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn() }));
jest.unstable_mockModule('../lib/email.js', () => ({
  sendEmail: jest.fn(),
  escapeHtml: (s: string) => s,
}));
const { db } = await import('../lib/firebase.js');
const { createApp } = await import('../app.js');
const { signAccessToken } = await import('../services/session.js');

const app = createApp();
const employee = { id: `authz-emp-${randomUUID().slice(0, 8)}`, role: 'employee' as const };
const users = db.collection('users');

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
const OWNER_ONLY: [Method, string][] = [
  ['post', '/CreateEmployee'],
  ['post', '/DeleteEmployee'],
  ['get', '/employees'],
  ['patch', '/employees/x'],
  ['post', '/employee/resend-invite'],
  ['post', '/tasks'],
  ['delete', '/tasks/x'],
  ['put', '/employees/x/schedule'],
  ['get', '/activities'],
];
const SIGNED_IN: [Method, string][] = [
  ...OWNER_ONLY,
  ['post', '/GetEmployee'],
  ['get', '/me'],
  ['patch', '/me'],
  ['get', '/tasks'],
  ['patch', '/tasks/x'],
  ['get', '/notifications'],
  ['patch', '/notifications/read'],
  ['get', '/directory'],
  ['get', '/presence'],
  ['get', '/conversations'],
  ['get', '/conversations/x/messages'],
  ['post', '/conversations/x/read'],
  ['get', '/schedules'],
  ['get', '/employees/x/schedule'],
];

beforeAll(async () => {
  await users.doc(employee.id).set({
    role: 'employee',
    name: 'Authz Employee',
    email: `${employee.id}@example.com`,
    phone: null,
    department: 'QA',
    title: '',
    status: 'active',
  });
});

afterAll(async () => {
  await users.doc(employee.id).delete();
});

it.each(SIGNED_IN)('%s %s needs a signed-in user', async (method, path) => {
  expect((await request(app)[method](`/api${path}`).send({})).status).toBe(401);
});

it.each(OWNER_ONLY)('%s %s is owner-only', async (method, path) => {
  const res = await request(app)
    [method](`/api${path}`)
    .set('Authorization', `Bearer ${signAccessToken(employee)}`)
    .send({});
  expect(res.status).toBe(403);
});
