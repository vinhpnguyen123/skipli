import { z } from 'zod';
import { accessCode } from './auth.js';
import { email } from './employees.js';

// base64url of 32 bytes is 43 chars; allow a little slack, reject anything else before touching Firestore.
const setupToken = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/, 'Invalid link');

// Lowercased so "Jane" and "jane" can't be two accounts.
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, '3–30 characters: letters, numbers, dots, dashes, underscores');

// bcrypt only uses the first 72 bytes, so longer passwords would silently match on a prefix.
const password = z
  .string()
  .min(8, 'At least 8 characters')
  .refine((p) => Buffer.byteLength(p) <= 72, 'At most 72 bytes');

export const setupCheckSchema = z.object({ token: setupToken }).strict();
export const setupSchema = z.object({ token: setupToken, username, password }).strict();
// Login only checks shape: a strength rule here would leak nothing useful and lock out old passwords.
export const passwordLoginSchema = z
  .object({ username, password: z.string().min(1).max(200) })
  .strict();
export const loginEmailSchema = z.object({ email }).strict();
export const validateEmployeeAccessCodeSchema = z.object({ email, accessCode }).strict();
