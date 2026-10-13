import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Tests run against the real dev services (Redis, later Firestore), so load server/.env when present.
// (process.loadEnvFile writes to the real process.env, not Jest's sandboxed copy, so parse it here.)
if (existsSync('.env')) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) process.env[k] ??= v;
}
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
// Satisfies env.ts in CI; unit tests mock lib/redis, so nothing connects to it.
process.env.REDIS_URL ??= 'redis://localhost:6379';
