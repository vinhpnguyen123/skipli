import { queryClient } from './query';
import type { SessionResponse, User } from './types';

// Empty in dev: vite proxies /api to localhost:3000. In production it is the Render URL.
const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Memory only. After a reload the refresh cookie restores it (see refreshSession).
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // The server requires this on cookie-authenticated routes (CSRF guard).
      'X-Requested-With': 'skipli',
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'INTERNAL',
      body?.error?.message ?? res.statusText,
    );
  return body as T;
}

let refreshing: Promise<User> | null = null;

// One refresh at a time: parallel 401s share it, so the rotated cookie is never presented twice
// (the server treats that as token theft and signs the user out).
export function refreshSession(): Promise<User> {
  refreshing ??= request<SessionResponse>('/auth/refresh', { method: 'POST' })
    .then((s) => {
      setAccessToken(s.accessToken);
      return s.user;
    })
    .catch((err) => {
      setAccessToken(null);
      queryClient.setQueryData(['session'], null); // route guard sends the user to /login
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Retries once after refreshing when the access token has expired.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'TOKEN_EXPIRED')) throw err;
    await refreshSession();
    return request<T>(path, init);
  }
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
