import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/firebase.js';

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
  for (const { id, ...doc } of [owner, demoOwner]) {
    batch.set(db.collection('users').doc(id), { ...base, ...doc });
  }
  for (const { id, ...doc } of employees) {
    batch.set(db.collection('users').doc(id), {
      ...base,
      ...doc,
      role: 'employee',
      status: 'invited',
      demo: true,
    });
  }
  await batch.commit();

  console.log(`seeded owner, demo owner ${demoOwner.phone}, ${employees.length} employees`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
