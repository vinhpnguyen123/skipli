// ponytail: node --env-file loads .env; no dotenv dependency.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  APP_URL: process.env.APP_URL ?? 'http://localhost:5173',
  DEMO_MODE: process.env.DEMO_MODE === 'true',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'skipli-dev',
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  REDIS_URL: required('REDIS_URL'),
};
