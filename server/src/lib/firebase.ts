import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../env.js';

// FIRESTORE_EMULATOR_HOST makes firebase-admin talk to the emulator, so credentials are optional there.
if (!getApps().length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  initializeApp({
    projectId: env.FIREBASE_PROJECT_ID,
    ...(privateKey && {
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    }),
  });
}

export const db = getFirestore();
