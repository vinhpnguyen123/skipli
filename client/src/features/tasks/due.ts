import { useEffect, useState } from 'react';
import type { Task } from '../../lib/types';

export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

// Done tasks are never overdue; open ones are overdue past their due time, due soon within 24 hours.
export function dueState(task: Task, now: number): 'overdue' | 'soon' | 'later' | null {
  if (!task.dueDate) return null;
  if (task.status === 'done') return 'later';
  const left = new Date(task.dueDate).getTime() - now;
  if (left < 0) return 'overdue';
  return left <= DUE_SOON_MS ? 'soon' : 'later';
}

// Viewer's locale and time zone (stored UTC, shown local).
export const formatDue = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

// <input type="datetime-local"> speaks local "YYYY-MM-DDTHH:mm" with no zone; the API speaks UTC ISO.
const pad = (n: number) => String(n).padStart(2, '0');
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (value: string): string | null =>
  value ? new Date(value).toISOString() : null; // `new Date('YYYY-MM-DDTHH:mm')` parses as local time

// Re-renders every minute so "due soon" and "overdue" badges flip on time without a reload.
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
