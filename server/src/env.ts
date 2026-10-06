// ponytail: node --env-file loads .env; no dotenv dependency.
export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  APP_URL: process.env.APP_URL ?? 'http://localhost:5173',
  DEMO_MODE: process.env.DEMO_MODE === 'true',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'skipli-dev',
};
