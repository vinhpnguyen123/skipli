// Empty in dev: vite proxies /api to localhost:3000. In production it is the Render URL.
const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? res.statusText);
  return body as T;
}
