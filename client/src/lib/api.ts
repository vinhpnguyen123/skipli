import { queryClient } from './query';
import type { SessionResponse, User } from './types';

// details: per-field problems from the server, e.g. [{ path: 'email', message: '…' }] (400) or [{ path: 'email' }] (409).
export type FieldIssue = { path: string; message?: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldIssue[];
  // The server's details as sent, for errors that carry data rather than field issues
  // (e.g. a 409 VERSION_CONFLICT's latest task).
  readonly data: unknown;
  constructor(status: number, code: string, message: string, data?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
    this.details = Array.isArray(data) ? data : [];
  }
}

// Maps a server error's details[].path to a message per form field, for showing under each input.
export function fieldErrors<F extends string>(
  err: unknown,
  fields: readonly F[],
): Partial<Record<F, string>> {
  if (!(err instanceof ApiError)) return {};
  const out: Partial<Record<F, string>> = {};
  for (const d of err.details) {
    if ((fields as readonly string[]).includes(d.path)) {
      out[d.path as F] =
        err.code === 'CONFLICT' ? 'Already in use by another account' : (d.message ?? 'Invalid');
    }
  }
  return out;
}

// Memory only. After a reload the refresh cookie restores it (see refreshSession).
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Always same-origin: Vite proxies /api to the server in dev, Vercel rewrites it to Render in production.
  // That keeps the refresh cookie first-party.
  const res = await fetch(`/api${path}`, {
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
      // Non-JSON errors (a proxy's HTML page, an old server without the route) have no message; HTTP/2
      // responses have no status text either. Fall back to something a user can report.
      body?.error?.message ?? `Request failed (${res.status})`,
      body?.error?.details,
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

// On a 401 for the access token, refresh once and retry. If the account is gone (deleted, disabled) the
// refresh fails too, which ends the session and sends the user to /login.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (err) {
    const authFailed =
      err instanceof ApiError && (err.code === 'TOKEN_EXPIRED' || err.code === 'UNAUTHENTICATED');
    if (!authFailed) throw err;
    await refreshSession();
    return request<T>(path, init);
  }
}

const send =
  (method: string) =>
  <T>(path: string, body?: unknown) =>
    api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
export const post = send('POST');
export const patch = send('PATCH');
export const del = send('DELETE');
