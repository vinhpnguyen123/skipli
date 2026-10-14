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
