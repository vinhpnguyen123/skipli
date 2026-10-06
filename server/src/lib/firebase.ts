import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../env.js';

// Service-account credentials are required: dev talks to skipli-dev, prod to skipli-prod.
// Private keys can't hold real newlines in a .env file, so they are stored escaped.
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

if (!privateKey || !clientEmail) {
  throw new Error('FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required');
}

if (!getApps().length) {
  initializeApp({
    projectId: env.FIREBASE_PROJECT_ID,
    credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail, privateKey }),
  });
}

export const db = getFirestore();
