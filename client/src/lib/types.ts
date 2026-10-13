// Mirrors PublicUser in server/src/services/auth.ts.
export type User = {
  id: string;
  role: 'owner' | 'employee';
  name: string;
  email: string;
  phone: string | null;
  department: string;
  title: string;
  status: 'invited' | 'active' | 'disabled';
};

export type SessionResponse = { accessToken: string; expiresIn: number; user: User };
