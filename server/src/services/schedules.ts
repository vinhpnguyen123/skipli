import { FieldValue, type DocumentSnapshot, type Timestamp } from 'firebase-admin/firestore';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';
import type { Shift } from '../schemas/schedules.js';
import { assertCanAccess } from './authz.js';
import { getEmployeeDoc } from './employees.js';
import { mutate } from './mutate.js';
import { getUser, users } from './users.js';

const schedules = db.collection('schedules');

// An employee without a schedule doc has no shifts yet. Times are local to timeZone.
export type Schedule = {
  employeeId: string;
  shifts: Shift[];
  timeZone: string;
  updatedAt: string | null;
};

const toSchedule = (employeeId: string, snap?: DocumentSnapshot): Schedule => ({
  employeeId,
  shifts: snap?.data()?.shifts ?? [],
  timeZone: env.BUSINESS_TZ,
  updatedAt: (snap?.data()?.updatedAt as Timestamp | undefined)?.toDate().toISOString() ?? null,
});

export async function getSchedule(viewer: AuthUser, employeeId: string): Promise<Schedule> {
  assertCanAccess(viewer, employeeId);
  if ((await getUser(employeeId))?.data()?.role !== 'employee')
    throw new AppError('NOT_FOUND', 'Employee not found', 404);
  return toSchedule(employeeId, await schedules.doc(employeeId).get());
}

// The owner gets every employee's (one per employee, empty ones included); an employee only their own.
export async function listSchedules(viewer: AuthUser): Promise<Schedule[]> {
  if (viewer.role === 'employee')
    return [toSchedule(viewer.id, await schedules.doc(viewer.id).get())];
  const [staff, docs] = await Promise.all([
    users.where('role', '==', 'employee').get(),
    schedules.get(),
  ]);
  const byId = new Map(docs.docs.map((d) => [d.id, d]));
  return staff.docs.map((u) => toSchedule(u.id, byId.get(u.id)));
}

// Replaces the whole week; shifts arrive already split, sorted and overlap-free (schemas/schedules.ts).
export async function putSchedule(
  actor: AuthUser,
  employeeId: string,
  shifts: Shift[],
): Promise<Schedule> {
  const ref = schedules.doc(employeeId);
  await mutate(async (tx) => {
    const employee = (await getEmployeeDoc(tx, users.doc(employeeId))).data()!;
    tx.set(ref, { shifts, updatedAt: FieldValue.serverTimestamp() });
    const schedule = { ...toSchedule(employeeId), shifts, updatedAt: new Date().toISOString() };
    return {
      result: undefined,
      activity: {
        actorId: actor.id,
        actorName: actor.name,
        action: 'schedule.updated',
        targetType: 'user',
        targetId: employeeId,
        targetName: employee.name,
        visibility: 'feed',
        metadata: { shifts: shifts.length },
      },
      emit: [{ to: ['owner', `user:${employeeId}`], event: 'schedule:updated', data: schedule }],
    };
  });
  return toSchedule(employeeId, await ref.get());
}
