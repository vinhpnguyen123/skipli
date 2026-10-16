import {
  Timestamp,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { AppError } from '../lib/errors.js';
import { db } from '../lib/firebase.js';
import type { AuthUser } from '../middleware/auth.js';
import type { CreateTaskInput, TaskStatus, UpdateTaskInput } from '../schemas/tasks.js';
import type { ActivityEntry } from './activity.js';
import { mutate, type Emit } from './mutate.js';
import { addNotification, emailIfOffline, formatDue } from './notifications.js';
import { users } from './users.js';

export const tasks = db.collection('tasks');
const OPEN: TaskStatus[] = ['todo', 'in_progress'];

export type Task = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  order: number;
  dueDate: string | null; // ISO, UTC
  version: number;
  createdAt: string;
  updatedAt: string;
};

const iso = (t: Timestamp | null | undefined) => t?.toDate().toISOString() ?? null;

export function toTask(id: string, d: DocumentData): Task {
  return {
    id,
    title: d.title,
    description: d.description,
    assigneeId: d.assigneeId ?? null,
    status: d.status,
    order: d.order,
    dueDate: iso(d.dueDate),
    version: d.version,
    createdAt: iso(d.createdAt)!,
    updatedAt: iso(d.updatedAt)!,
  };
}

// Task events go to the owner and to every employee the task belongs (or belonged) to.
const roomsFor = (...assignees: (string | null | undefined)[]) => [
  'owner',
  ...new Set(assignees.filter((a): a is string => !!a).map((a) => `user:${a}`)),
];

// Employees only ever see their own tasks; anything else looks like it doesn't exist (no id probing).
const notFound = () => new AppError('NOT_FOUND', 'Task not found', 404);

// Returns the assignee's name, snapshotted into the activity entry.
async function assertAssignable(tx: Transaction, assigneeId: string | null) {
  if (!assigneeId) return null;
  const assignee = (await tx.get(users.doc(assigneeId))).data();
  if (assignee?.role !== 'employee') {
    throw new AppError('VALIDATION_ERROR', 'Unknown employee', 400, [
      { in: 'body', path: 'assigneeId', message: 'No such employee' },
    ]);
  }
  return assignee.name as string;
}

const taskActivity = (actor: AuthUser, id: string, title: string, action: string, metadata = {}) =>
  ({
    actorId: actor.id,
    actorName: actor.name,
    action,
    targetType: 'task',
    targetId: id,
    targetName: title,
    visibility: 'feed',
    metadata,
  }) satisfies ActivityEntry;

// ponytail: the whole set, sorted in memory; one small team. Add an (assigneeId, status, order) index and
// paging if boards grow to thousands of tasks.
export async function listTasks(viewer: AuthUser, assigneeId?: string): Promise<Task[]> {
  let q: Query = tasks;
  if (viewer.role === 'employee') q = q.where('assigneeId', '==', viewer.id);
  else if (assigneeId === 'none') q = q.where('assigneeId', '==', null);
  else if (assigneeId) q = q.where('assigneeId', '==', assigneeId);
  const snap = await q.get();
  return snap.docs.map((d) => toTask(d.id, d.data())).sort((a, b) => a.order - b.order);
}

export async function createTask(actor: AuthUser, input: CreateTaskInput): Promise<Task> {
  const ref = tasks.doc();
  const task = await mutate(async (tx) => {
    const assigneeName = await assertAssignable(tx, input.assigneeId);
    const now = Timestamp.now();
    const data = {
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId,
      status: 'todo',
      // ponytail: new tasks go to the bottom by creation time; moves place cards between neighbours.
      order: now.toMillis(),
      dueDate: input.dueDate ? Timestamp.fromDate(input.dueDate) : null,
      version: 1,
      reminderSentAt: null,
      overdueNotifiedAt: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(ref, data);
    const task = toTask(ref.id, data);
    return {
      result: task,
      activity: taskActivity(actor, ref.id, task.title, 'task.created', {
        assigneeId: task.assigneeId,
        assigneeName,
      }),
      emit: [
        { to: roomsFor(task.assigneeId), event: 'task:created', data: task },
        ...(task.assigneeId ? [notifyAssigned(tx, task, actor)] : []),
      ],
    };
  });
  if (task.assigneeId) void emailAssigned(task, actor);
  return task;
}

// The assignee hears about a task given to them: in the app now, and by email if they have no tab open.
const notifyAssigned = (tx: Transaction, task: Task, actor: AuthUser) =>
  addNotification(tx, task.assigneeId!, 'task.assigned', {
    taskId: task.id,
    title: task.title,
    by: actor.name,
    dueDate: task.dueDate,
  });

const emailAssigned = (task: Task, actor: AuthUser) =>
  emailIfOffline(task.assigneeId!, `New task: ${task.title}`, () => [
    `${actor.name} assigned you "${task.title}".`,
    ...(task.dueDate ? [`Due ${formatDue(task.dueDate)}.`] : []),
  ]);

// One entry per change, named for what matters most; reordering within a column is not logged.
function describeChange(before: DocumentData, after: Task): string | null {
  if (after.status !== before.status)
    return after.status === 'done' ? 'task.completed' : 'task.moved';
  if (after.assigneeId !== (before.assigneeId ?? null)) return 'task.assigned';
  const edited = ['title', 'description', 'dueDate'].some(
    (k) => after[k as keyof Task] !== (k === 'dueDate' ? iso(before.dueDate) : before[k]),
  );
  return edited ? 'task.updated' : null;
}

const EMPLOYEE_FIELDS = new Set(['version', 'status', 'order']);

export async function updateTask(
  actor: AuthUser,
  id: string,
  patch: UpdateTaskInput,
): Promise<Task> {
  const ref = tasks.doc(id);
  const { task, newlyAssigned } = await mutate(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.data();
    if (!before) throw notFound();
    if (actor.role === 'employee') {
      if (before.assigneeId !== actor.id) throw notFound();
      if (Object.keys(patch).some((k) => !EMPLOYEE_FIELDS.has(k))) {
        throw new AppError(
          'FORBIDDEN',
          'Employees can only change the status and position of their tasks',
          403,
        );
      }
    }
    if (patch.version !== before.version) {
      // The client shows this version and retries if the user still wants to.
      throw new AppError('VERSION_CONFLICT', 'This task was changed by someone else', 409, {
        task: toTask(id, before),
      });
    }
    const reassigned = patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId;
    const assigneeName = reassigned ? await assertAssignable(tx, patch.assigneeId!) : undefined;

    const { version, dueDate, ...rest } = patch;
    const changes = {
      ...rest,
      ...(dueDate !== undefined && { dueDate: dueDate ? Timestamp.fromDate(dueDate) : null }),
      // A new due date earns new reminders.
      ...(dueDate !== undefined && { reminderSentAt: null, overdueNotifiedAt: null }),
      version: version + 1,
      updatedAt: Timestamp.now(),
    };
    tx.update(ref, changes);
    const task = toTask(id, { ...before, ...changes });
    const action = describeChange(before, task);
    const newlyAssigned = !!task.assigneeId && task.assigneeId !== before.assigneeId;
    return {
      result: { task, newlyAssigned },
      activity: action
        ? taskActivity(actor, id, task.title, action, {
            status: task.status,
            ...(reassigned && { assigneeId: task.assigneeId, assigneeName }),
          })
        : undefined,
      emit: [
        // The previous assignee hears about it too, so the task leaves their board.
        { to: roomsFor(before.assigneeId, task.assigneeId), event: 'task:updated', data: task },
        ...(newlyAssigned ? [notifyAssigned(tx, task, actor)] : []),
      ],
    };
  });
  if (newlyAssigned) void emailAssigned(task, actor);
  return task;
}

export async function deleteTask(actor: AuthUser, id: string): Promise<void> {
  const ref = tasks.doc(id);
  await mutate(async (tx) => {
    const before = (await tx.get(ref)).data();
    if (!before) throw notFound();
    tx.delete(ref);
    return {
      result: undefined,
      activity: taskActivity(actor, id, before.title, 'task.deleted'),
      emit: [{ to: roomsFor(before.assigneeId), event: 'task:deleted', data: { id } }],
    };
  });
}

// For deleting an employee: read their open tasks (a transaction does all reads before any write)...
export async function readOpenTasks(tx: Transaction, employeeId: string) {
  return (await tx.get(tasks.where('assigneeId', '==', employeeId).where('status', 'in', OPEN)))
    .docs;
}

// ...then unassign them so the owner can hand the work to someone else. Done tasks keep their assignee.
export function unassignTasks(tx: Transaction, docs: QueryDocumentSnapshot[]): Emit[] {
  const updatedAt = Timestamp.now();
  return docs.map((doc) => {
    const changes = { assigneeId: null, version: doc.data().version + 1, updatedAt };
    tx.update(doc.ref, changes);
    return {
      to: ['owner'],
      event: 'task:updated',
      data: toTask(doc.id, { ...doc.data(), ...changes }),
    };
  });
}
