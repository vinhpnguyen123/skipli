import type { Server, Socket } from 'socket.io';
import { redis } from '../lib/redis.js';

// Who's online, shared by every instance through Redis:
//   presence       sorted set, userId -> last heartbeat (ms). Online = heartbeat within TTL_MS.
//   presence:seen  hash, userId -> ISO time their last socket closed ("last seen").
// Each instance re-stamps the users it has sockets for every HEARTBEAT_MS, then sweeps entries older than
// TTL_MS. An instance that crashes stops stamping, so its users drop to offline within TTL_MS.
// Socket.IO's own ping already closes sockets of dead tabs, so clients don't send heartbeats.
export const HEARTBEAT_MS = 20_000;
export const TTL_MS = 45_000;
const ONLINE = 'presence';
const SEEN = 'presence:seen';

export type PresenceUpdate = { userId: string; online: boolean; lastSeen: string | null };

// Presence is a nicety: a Redis outage logs and moves on, it never breaks a connection.
const safely = async <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (err) {
    console.warn(`presence ${what} failed:`, (err as Error).message);
  }
};

// Every signed-in socket hears every change: the directory, chat list and Employees page all show dots.
const announce = (io: Server, update: PresenceUpdate) => io.emit('presence:update', update);

async function stamp(io: Server, userIds: string[]) {
  if (!userIds.length) return;
  const now = Date.now();
  const multi = redis.multi();
  for (const id of userIds) multi.zadd(ONLINE, now, id);
  const added = (await multi.exec()) ?? [];
  // ZADD returns 1 for a member that wasn't there: that user just came online.
  userIds.forEach((id, i) => {
    if (added[i]?.[1] === 1) announce(io, { userId: id, online: true, lastSeen: null });
  });
}

// Atomically: remove the user only if their heartbeat is still no newer than `notAfter`, and record last seen.
// A heartbeat or reconnect that lands after the caller looked (on any instance) moves the score past
// `notAfter`, so it survives. Only the caller that removed the user announces it: one update per change.
const REMOVE_IF_STALE = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score or tonumber(score) > tonumber(ARGV[2]) then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
return 1`;

async function markOffline(io: Server, userId: string, notAfter: number, lastSeen: Date) {
  const iso = lastSeen.toISOString();
  if ((await redis.eval(REMOVE_IF_STALE, 2, ONLINE, SEEN, userId, notAfter, iso)) !== 1) return;
  announce(io, { userId, online: false, lastSeen: iso });
}

export function trackPresence(io: Server, socket: Socket, userId: string) {
  void safely('connect', () => stamp(io, [userId]));
  socket.on('disconnect', () => {
    void safely('disconnect', async () => {
      const checkedAt = Date.now();
      // Other tabs or devices, on any instance (the adapter asks them all), keep the user online.
      if ((await io.in(`user:${userId}`).fetchSockets()).length) return;
      await markOffline(io, userId, checkedAt, new Date());
    });
  });
}

// One heartbeat: re-stamp local users (which also heals a reconnect that raced a disconnect), then sweep
// users whose instance stopped stamping. Exported so tests can run it without waiting.
export async function presenceTick(io: Server) {
  const local = [...io.of('/').adapter.rooms.keys()]
    .filter((r) => r.startsWith('user:'))
    .map((r) => r.slice('user:'.length));
  await safely('heartbeat', () => stamp(io, local));
  await safely('sweep', async () => {
    const cutoff = Date.now() - TTL_MS;
    const stale = await redis.zrangebyscore(ONLINE, '-inf', cutoff, 'WITHSCORES');
    for (let i = 0; i < stale.length; i += 2) {
      await markOffline(io, stale[i], cutoff, new Date(Number(stale[i + 1])));
    }
  });
}

export function startPresenceHeartbeat(io: Server) {
  setInterval(() => void presenceTick(io), HEARTBEAT_MS).unref();
}

// Snapshot for GET /presence: who's online now, and when everyone else was last seen.
// Redis down = nobody shows as online, rather than an error.
export async function getPresence() {
  const snapshot = await safely('snapshot', async () => {
    const [online, lastSeen] = await Promise.all([
      redis.zrangebyscore(ONLINE, Date.now() - TTL_MS, '+inf'),
      redis.hgetall(SEEN),
    ]);
    return { online, lastSeen };
  });
  return snapshot ?? { online: [], lastSeen: {} };
}
