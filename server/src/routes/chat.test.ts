import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';

// Firestore is the real skipli-dev project; Redis, SMS and email are mocked.
const redis = new RedisMock();
jest.unstable_mockModule('../lib/redis.js', () => ({ redis }));
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
type Person = { id: string; role: 'owner' | 'employee'; name: string; status?: string };
const p = (
  key: string,
  name: string,
  role: Person['role'] = 'employee',
  status = 'active',
): Person => ({
  id: `ch-${key}-${run}`,
  role,
  name,
  status,
});
const owner = p('owner', 'Chat Owner', 'owner');
const ann = p('ann', 'Ann');
const bob = p('bob', 'Bob');
const cat = p('cat', 'Cat');
const ivy = p('ivy', 'Ivy (invited)', 'employee', 'invited');
const dan = p('dan', 'Dan'); // deleted part-way through
const people = [owner, ann, bob, cat, ivy, dan];
const users = db.collection('users');
const conversations = db.collection('conversations');

const idFor = (a: Person, b: Person) => [a.id, b.id].sort().join('_');
const auth = (x: Person) => ({ Authorization: `Bearer ${signAccessToken(x)}` });
const get = (x: Person, path: string) => request(app).get(`/api${path}`).set(auth(x));
const settle = () => new Promise((r) => setTimeout(r, 400));

let server: Server;
const sockets: Socket[] = [];

// A connected client for `x`, recording every event it receives.
async function client(x: Person) {
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  const s = connect(url, {
    transports: ['websocket'],
    auth: { token: signAccessToken(x) },
    reconnection: false,
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.on('connect', resolve);
    s.on('connect_error', reject);
  });
  const events: [string, Record<string, unknown>][] = [];
  s.onAny((event, data) => events.push([event, data]));
  const send = (conversationId: string, text: string, clientMessageId = randomUUID()) =>
    s.timeout(5000).emitWithAck('message:send', { conversationId, clientMessageId, text });
  return { s, events, send };
}

beforeAll(async () => {
  for (const x of people) {
    await users.doc(x.id).set({
      role: x.role,
      name: x.name,
      email: `${x.id}@example.com`,
      phone: `+1555${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
      department: 'QA',
      title: 'Tester',
      username: null,
      status: x.status,
    });
  }
  server = createServer(app);
  initSocket(server);
  await new Promise<void>((r) => server.listen(0, r));
});

beforeEach(async () => {
  await redis.flushall();
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await new Promise((r) => server.close(r));
  const ids = people.map((x) => x.id);
  // Conversations have a messages subcollection; recursiveDelete removes both.
  const convs = await conversations.where('participantIds', 'array-contains-any', ids).get();
  for (const doc of convs.docs) await db.recursiveDelete(doc.ref);
  const batch = db.batch();
  for (const id of ids) batch.delete(users.doc(id));
  for (const doc of (await db.collection('activities').where('actorId', '==', owner.id).get())
    .docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
});

describe('sending', () => {
  it('delivers to both participants only, creates the conversation and counts it unread for the recipient', async () => {
    const [a, b, c] = [await client(ann), await client(bob), await client(cat)];
    const id = idFor(ann, bob);
    const ack = await a.send(id, '  Hi Bob  ');
    expect(ack).toMatchObject({ ok: true, message: { senderId: ann.id, text: 'Hi Bob' } });
    await settle();

    const got = (events: typeof a.events) =>
      events.filter(([e]) => e === 'message:new').map(([, d]) => d);
    expect(got(a.events)).toEqual([{ conversationId: id, message: ack.message }]);
    expect(got(b.events)).toEqual([{ conversationId: id, message: ack.message }]);
    expect(got(c.events)).toEqual([]);

    const conv = (await conversations.doc(id).get()).data()!;
    expect(conv).toMatchObject({
      participantIds: [ann.id, bob.id].sort(),
      lastMessage: 'Hi Bob',
      lastSenderId: ann.id,
      unread: { [bob.id]: 1 },
      names: { [ann.id]: 'Ann', [bob.id]: 'Bob' },
    });
  });

  it('treats a resend of the same clientMessageId as the same message', async () => {
    const a = await client(ann);
    const id = idFor(ann, cat);
    const clientMessageId = randomUUID();
    const first = await a.send(id, 'Once', clientMessageId);
    const again = await a.send(id, 'Once', clientMessageId);
    expect(again).toEqual(first);
    expect((await conversations.doc(id).collection('messages').get()).size).toBe(1);
    expect((await conversations.doc(id).get()).data()!.unread[cat.id]).toBe(1);
  });

  it("refuses to reuse someone else's message id", async () => {
    const [a, c] = [await client(ann), await client(cat)];
    const id = idFor(ann, cat);
    const clientMessageId = randomUUID();
    await a.send(id, 'Mine', clientMessageId);
    expect(await c.send(id, 'Hijack', clientMessageId)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
  });

  it('lets employees chat with each other and with the owner', async () => {
    const [a, o] = [await client(ann), await client(owner)];
    expect((await a.send(idFor(ann, owner), 'Hi boss')).ok).toBe(true);
    expect((await o.send(idFor(ann, owner), 'Hi Ann')).ok).toBe(true);
  });

  it('rejects conversations the sender is not part of, odd ids, and chatting with yourself', async () => {
    const a = await client(ann);
    const notMine = await a.send(idFor(bob, cat), 'Snooping');
    expect(notMine).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    const reversed = [ann.id, bob.id].sort().reverse().join('_');
    expect(await a.send(reversed, 'Wrong order')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await a.send(`${ann.id}_${ann.id}`, 'Me')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('validates the message', async () => {
    const a = await client(ann);
    const id = idFor(ann, bob);
    for (const [text, expected] of [
      ['   ', 'Message is empty'],
      ['x'.repeat(2001), 'At most 2000 characters'],
    ]) {
      expect(await a.send(id, text)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: expected },
      });
    }
    const extra = await a.s
      .timeout(5000)
      .emitWithAck('message:send', {
        conversationId: id,
        clientMessageId: randomUUID(),
        text: 'x',
        admin: true,
      });
    expect(extra).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it("won't deliver to someone who hasn't finished setup", async () => {
    const a = await client(ann);
    expect(await a.send(idFor(ann, ivy), 'Hello?')).toMatchObject({
      ok: false,
      error: { code: 'CONVERSATION_CLOSED' },
    });
  });

  it('rate limits bursts', async () => {
    const b = await client(bob);
    const id = idFor(bob, cat);
    const acks = [];
    for (let i = 0; i < 21; i++) acks.push(await b.send(id, `#${i}`));
    expect(acks.slice(0, 20).every((x) => x.ok)).toBe(true);
    expect(acks[20]).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('reading', () => {
  it('lists conversations with the unread count and other person, and hides others', async () => {
    const a = await client(ann);
    await a.send(idFor(ann, bob), 'For the list');
    const bobList = (await get(bob, '/conversations')).body.conversations;
    const conv = bobList.find((c: { id: string }) => c.id === idFor(ann, bob));
    expect(conv).toMatchObject({
      lastMessage: 'For the list',
      lastSenderId: ann.id,
      other: { id: ann.id, name: 'Ann', title: 'Tester', role: 'employee', active: true },
    });
    expect(conv.unread).toBeGreaterThanOrEqual(1);
    const ivyList = (await get(ivy, '/conversations')).status; // not active: refused at requireAuth
    expect(ivyList).toBe(401);
  });

  it("returns 404 for a conversation you're not in (no reading B↔C)", async () => {
    expect((await get(ann, `/conversations/${idFor(bob, cat)}/messages`)).status).toBe(404);
    expect(
      (
        await request(app)
          .post(`/api/conversations/${idFor(bob, cat)}/read`)
          .set(auth(ann))
      ).status,
    ).toBe(404);
  });

  it('pages back through history without gaps or repeats', async () => {
    const o = await client(owner);
    const id = idFor(owner, cat);
    const sent = [];
    for (let i = 0; i < 5; i++) sent.push((await o.send(id, `m${i}`)).message.text);

    const page1 = (await get(owner, `/conversations/${id}/messages?limit=2`)).body;
    expect(page1.messages.map((m: { text: string }) => m.text)).toEqual(['m3', 'm4']);
    expect(page1.hasMore).toBe(true);
    const page2 = (
      await get(owner, `/conversations/${id}/messages?limit=2&before=${page1.messages[0].id}`)
    ).body;
    expect(page2.messages.map((m: { text: string }) => m.text)).toEqual(['m1', 'm2']);
    const page3 = (
      await get(owner, `/conversations/${id}/messages?limit=2&before=${page2.messages[0].id}`)
    ).body;
    expect(page3).toMatchObject({ hasMore: false });
    expect(page3.messages.map((m: { text: string }) => m.text)).toEqual(['m0']);
    expect(sent).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });

  it('marking read resets the count and tells the sender (for "Seen") and the reader\'s other tabs', async () => {
    const [a, b1, b2] = [await client(ann), await client(bob), await client(bob)];
    const id = idFor(ann, bob);
    await a.send(id, 'Read me');
    const res = await request(app).post(`/api/conversations/${id}/read`).set(auth(bob));
    expect(res.body).toMatchObject({ success: true, lastReadAt: expect.any(String) });
    await settle();
    expect((await conversations.doc(id).get()).data()!.unread[bob.id]).toBe(0);
    const readEvent = { conversationId: id, userId: bob.id, lastReadAt: res.body.lastReadAt };
    expect(a.events).toContainEqual(['conversation:read', readEvent]);
    expect(b2.events).toContainEqual(['conversation:read', readEvent]);
    expect(b1.events).toContainEqual(['conversation:read', readEvent]);

    const annList = (await get(ann, '/conversations')).body.conversations;
    expect(annList.find((c: { id: string }) => c.id === id).otherLastReadAt).toBe(
      res.body.lastReadAt,
    );
  });
});

describe('directory', () => {
  it('lists active coworkers with job info only, not contact details or the caller', async () => {
    const res = await get(ann, '/directory');
    const ids = res.body.people.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining([owner.id, bob.id, cat.id]));
    expect(ids).not.toContain(ann.id);
    expect(ids).not.toContain(ivy.id);
    const bobEntry = res.body.people.find((x: { id: string }) => x.id === bob.id);
    expect(bobEntry).toEqual({
      id: bob.id,
      name: 'Bob',
      title: 'Tester',
      department: 'QA',
      role: 'employee',
    });
  });
});

describe('after a participant is deleted', () => {
  it('keeps the history readable but closes the conversation', async () => {
    const a = await client(ann);
    const id = idFor(ann, dan);
    await a.send(id, 'Before');
    await request(app)
      .post('/api/DeleteEmployee')
      .set(auth(owner))
      .send({ employeeId: dan.id })
      .expect(200);

    const conv = (await get(ann, '/conversations')).body.conversations.find(
      (c: { id: string }) => c.id === id,
    );
    expect(conv.other).toEqual({
      id: dan.id,
      name: 'Dan',
      title: '',
      role: 'employee',
      active: false,
    });
    expect(
      (await get(ann, `/conversations/${id}/messages`)).body.messages.map(
        (m: { text: string }) => m.text,
      ),
    ).toEqual(['Before']);
    expect(await a.send(id, 'After')).toMatchObject({
      ok: false,
      error: { code: 'CONVERSATION_CLOSED' },
    });
  });
});
