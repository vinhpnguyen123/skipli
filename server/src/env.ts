// ponytail: node --env-file loads .env; no dotenv dependency.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  APP_URL: process.env.APP_URL ?? 'http://localhost:5173',
  // Business time zone for dates in emails and (phase 5) schedules.
  BUSINESS_TZ: process.env.BUSINESS_TZ ?? 'America/New_York',
  DEMO_MODE: process.env.DEMO_MODE === 'true',
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'skipli-dev',
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  OTP_HMAC_SECRET: required('OTP_HMAC_SECRET'),
  REDIS_URL: required('REDIS_URL'),
  // Express 'trust proxy': a hop count (Render = 1) or an IP/CIDR list. req.ip, and so rate limits, depend on it.
  TRUST_PROXY: trustProxy(process.env.TRUST_PROXY ?? '1'),
  // Shared with Vercel, which sends it on the /api rewrite. When set, /api only accepts requests carrying it.
  ORIGIN_SECRET: process.env.ORIGIN_SECRET,
  // The scheduler (GitHub Actions) sends it to /api/cron/*. Unset = cron endpoints refuse every call.
  CRON_SECRET: process.env.CRON_SECRET,
  // Optional: without them SMS sends fail (logged), and only demo accounts can sign in.
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM: process.env.TWILIO_FROM,
  // Optional: without them invite emails fail (logged); in DEMO_MODE the owner still gets the invite link.
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
};

function trustProxy(value: string): number | string {
  return /^\d+$/.test(value) ? Number(value) : value;
}
