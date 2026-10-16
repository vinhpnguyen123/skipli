// Mirrors PublicUser in server/src/services/auth.ts.
export type User = {
  id: string;
  role: 'owner' | 'employee';
  name: string;
  email: string;
  phone: string | null;
  department: string;
  title: string;
  username: string | null;
  status: 'invited' | 'active' | 'disabled';
};

export type SessionResponse = { accessToken: string; expiresIn: number; user: User };

export type TaskStatus = 'todo' | 'in_progress' | 'done';

// Mirrors Task in server/src/services/tasks.ts. Dates are ISO strings in UTC.
export type Task = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  order: number;
  dueDate: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

// Mirrors Notification in server/src/services/notifications.ts.
export type AppNotification = {
  id: string;
  type: 'task.assigned' | 'task.due_soon' | 'task.overdue';
  payload: { taskId: string; title: string; by?: string; dueDate?: string | null };
  read: boolean;
  createdAt: string;
};

// Mirrors server/src/services/chat.ts.
export type Message = { id: string; senderId: string; text: string; createdAt: string };

// `active: false` = deleted or no longer active: the chat stays readable but you can't reply.
export type Participant = {
  id: string;
  name: string;
  title: string;
  role: 'owner' | 'employee';
  active: boolean;
};

export type Conversation = {
  id: string;
  other: Participant;
  lastMessage: string;
  lastMessageAt: string | null;
  lastSenderId: string | null;
  unread: number;
  otherLastReadAt: string | null;
};

// GET /directory: coworkers you can start a chat with.
export type Person = {
  id: string;
  name: string;
  title: string;
  department: string;
  role: 'owner' | 'employee';
};

// Mirrors server/src/services/schedules.ts. Times are 'HH:mm' wall-clock in timeZone (the business's);
// overnight shifts arrive split at midnight, so `end` can be '24:00'.
export type Shift = { dayOfWeek: number; start: string; end: string };
export type Schedule = {
  employeeId: string;
  shifts: Shift[];
  timeZone: string;
  updatedAt: string | null;
};

// Mirrors Activity in server/src/services/activity.ts. Names are snapshots from when it happened.
export type Activity = {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  visibility: 'feed' | 'audit';
  metadata: Record<string, unknown>;
  createdAt: string;
};
