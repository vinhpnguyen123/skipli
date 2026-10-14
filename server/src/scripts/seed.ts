import bcrypt from 'bcryptjs';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/firebase.js';
import { BCRYPT_COST } from '../services/onboarding.js';

// The demo employee's password is public on purpose (README, for reviewers). Override it with SEED_DEMO_PASSWORD.
const DEMO_USERNAME = 'demo.employee';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'skipli-demo-2026';

// ponytail: fixed doc ids so re-seeding is idempotent and README can name the demo accounts.
const owner = {
  id: 'owner',
  role: 'owner' as const,
  name: 'Owner',
  email: process.env.SEED_OWNER_EMAIL ?? 'owner@example.com',
  phone: process.env.SEED_OWNER_PHONE ?? '+10000000000',
  department: 'Management',
  title: 'Manager',
  status: 'active' as const,
  demo: false,
};

// demo: true + DEMO_MODE=true → login codes come back in the API response instead of by SMS/email,
// so reviewers can sign in. 555-01xx numbers are reserved for fiction.
const demoOwner = {
  ...owner,
  id: 'demo-owner',
  name: 'Demo Owner',
  email: 'demo.owner@example.com',
  phone: '+15555550100',
  demo: true,
};

const employees = [
  {
    id: 'demo-employee-1',
    name: 'Demo Employee',
    email: 'demo.employee@example.com',
    phone: '+10000000001',
    department: 'Engineering',
    title: 'Developer',
  },
  {
    id: 'demo-employee-2',
    name: 'Second Employee',
    email: 'second.employee@example.com',
    phone: '+10000000002',
    department: 'Support',
    title: 'Agent',
  },
];

async function seed() {
  const base = {
    username: null,
    passwordHash: null,
    failedLogins: 0,
    lockedUntil: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  // Same reservations the API makes (services/employees.ts), so seeded emails/phones can't be reused.
  for (const { id, email, phone } of [owner, demoOwner, ...employees]) {
    batch.set(db.collection('uniques').doc(`email:${email}`), { userId: id });
    batch.set(db.collection('uniques').doc(`phone:${phone}`), { userId: id });
  }
  for (const { id, ...doc } of [owner, demoOwner]) {
    batch.set(db.collection('users').doc(id), { ...base, ...doc });
  }
  // The first demo employee is already set up (password + email-code login work); the second is still
  // invited, so the onboarding flow can be tried with a fresh invite link from the dashboard.
  const [setUp, invited] = employees;
  const { id: setUpId, ...setUpDoc } = setUp;
  batch.set(db.collection('users').doc(setUpId), {
    ...base,
    ...setUpDoc,
    role: 'employee',
    status: 'active',
    username: DEMO_USERNAME,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST),
    demo: true,
  });
  batch.set(db.collection('uniques').doc(`username:${DEMO_USERNAME}`), { userId: setUpId });
  const { id: invitedId, ...invitedDoc } = invited;
  batch.set(db.collection('users').doc(invitedId), {
    ...base,
    ...invitedDoc,
    role: 'employee',
    status: 'invited',
    demo: true,
  });
  await batch.commit();

  console.log(
    `seeded owner, demo owner ${demoOwner.phone}, ${DEMO_USERNAME} (active), ${invited.email} (invited)`,
  );
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
