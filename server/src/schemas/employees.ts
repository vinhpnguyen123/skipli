import { z } from 'zod';
import { phoneNumber } from './auth.js';

const text = (max: number) => z.string().trim().min(1).max(max);

// Lowercased so uniqueness and email-code login don't depend on how it was typed.
export const email = z.string().trim().toLowerCase().email().max(254);
export const employeeId = z.string().min(1).max(128);

const fields = {
  name: text(100),
  email,
  department: text(100),
  // Optional at creation (the spec's CreateEmployee lists only name/email/department); employees can add a phone later.
  phone: phoneNumber.optional(),
  title: z.string().trim().max(100).optional(),
};

export const createEmployeeSchema = z.object(fields).strict();
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

// Every field optional; null clears the phone.
export const updateEmployeeSchema = z
  .object({ ...fields, phone: phoneNumber.nullable().optional() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeIdBody = z.object({ employeeId }).strict();
export const employeeIdParams = z.object({ id: employeeId }).strict();

// Self-service: contact details only. Role, department, title, username and status are set by the owner
// (or by onboarding), and .strict() rejects them here.
export const updateProfileSchema = z
  .object({ name: fields.name, email, phone: phoneNumber.nullable() })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
