import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// The endpoint only: who may call it, and that it runs the job and returns its result. The job is stubbed,
// so this never touches Firestore. (At the real time it would send reminders for whatever dev tasks are due;
// the job itself is tested in cron.test.ts with a 2001 clock.)
process.env.CRON_SECRET = 'test-cron-secret';
const summary = { checked: 3, dueSoon: 1, overdue: 1 };
const sendDueReminders = jest.fn<() => Promise<typeof summary>>().mockResolvedValue(summary);
jest.unstable_mockModule('../services/reminders.js', () => ({ sendDueReminders }));
const { cronRouter } = await import('./cron.js');
const { errorHandler } = await import('../lib/errors.js');

const app = express();
app.use('/api/cron', cronRouter);
app.use(errorHandler);
const call = () => request(app).post('/api/cron/due-reminders');

beforeEach(() => sendDueReminders.mockClear());

describe('POST /api/cron/due-reminders', () => {
  it('refuses calls without the secret or with a wrong one, and runs nothing', async () => {
    expect((await call()).status).toBe(401);
    expect((await call().set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await call().set('Authorization', 'test-cron-secret')).status).toBe(401); // missing "Bearer "
    expect((await call().set('Authorization', 'Bearer test-cron-secret-but-longer')).status).toBe(
      401,
    );
    expect(sendDueReminders).not.toHaveBeenCalled();
  });

  it('runs the job once with the right secret and returns its summary', async () => {
    const res = await call().set('Authorization', 'Bearer test-cron-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, ...summary });
    expect(sendDueReminders).toHaveBeenCalledTimes(1);
  });
});
