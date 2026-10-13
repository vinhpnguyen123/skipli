import { z } from 'zod';

// E.164 after dropping spaces, dashes, dots, and parentheses, so "+1 (555) 555-0100" is accepted.
export const phoneNumber = z
  .string()
  .transform((s) => s.replace(/[\s().-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +15555550100'));

export const accessCode = z.string().regex(/^\d{6}$/, 'Code is 6 digits');

export const createNewAccessCodeSchema = z.object({ phoneNumber }).strict();
export const validateOwnerAccessCodeSchema = z.object({ phoneNumber, accessCode }).strict();
