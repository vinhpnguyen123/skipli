import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, api, del, patch, post } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { socket } from '../../lib/socket';
import type { Task, TaskStatus, User } from '../../lib/types';

const KEY = ['tasks'];

export type TaskChanges = Partial<{
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null; // ISO UTC
  status: TaskStatus;
  order: number;
}>;

export type NewTask = {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
};

// Cache helpers. The board sorts by `order` when rendering, so the list itself is unordered.
const write = (fn: (list: Task[]) => Task[]) =>
  queryClient.setQueryData<Task[]>(KEY, (list) => (list ? fn(list) : list));
const put = (task: Task) => write((list) => [...list.filter((t) => t.id !== task.id), task]);
const drop = (id: string) => write((list) => list.filter((t) => t.id !== id));

export function useTasks() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api<{ tasks: Task[] }>('/tasks')).tasks,
  });
}

// Keeps the cached board in step with other people's changes, and reloads it after a reconnect so
// nothing that happened while offline is missed.
export function useTaskEvents(me: User) {
  useEffect(() => {
    const upsert = (task: Task) =>
      write((list) => {
        const current = list.find((t) => t.id === task.id);
        if (current && current.version > task.version) return list; // an older event arriving late
        const rest = list.filter((t) => t.id !== task.id);
        // A task reassigned away from this employee leaves their board.
        if (me.role === 'employee' && task.assigneeId !== me.id) return rest;
        return [...rest, task];
      });
    const remove = ({ id }: { id: string }) => drop(id);
    const reload = () => queryClient.invalidateQueries({ queryKey: KEY });

    socket.on('task:created', upsert).on('task:updated', upsert).on('task:deleted', remove);
    socket.on('connect', reload);
    return () => {
      socket.off('task:created', upsert).off('task:updated', upsert).off('task:deleted', remove);
      socket.off('connect', reload);
    };
  }, [me.id, me.role]);
}

export const isConflict = (err: unknown): err is ApiError & { data: { task: Task } } =>
  err instanceof ApiError && err.code === 'VERSION_CONFLICT';

// Moves and edits show up immediately. On failure the card goes back, unless something newer (a socket
// event, a refetch) already replaced it; on a version conflict the server's latest copy is shown instead.
export function useUpdateTask() {
  return useMutation({
    mutationFn: ({ task, changes }: { task: Task; changes: TaskChanges }) =>
      patch<Task>(`/tasks/${task.id}`, { version: task.version, ...changes }),
    onMutate: async ({ task, changes }) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      put({ ...task, ...changes }); // same version: any newer server copy still wins
      return { previous: task };
    },
    onSuccess: put,
    onError: (err, _vars, context) => {
      if (isConflict(err)) return put(err.data.task);
      const previous = context?.previous;
      if (!previous) return;
      write((list) => {
        const current = list.find((t) => t.id === previous.id);
        return current?.version === previous.version
          ? [...list.filter((t) => t.id !== previous.id), previous]
          : list;
      });
    },
  });
}

export function useCreateTask() {
  return useMutation({
    mutationFn: (input: NewTask) => post<Task>('/tasks', input),
    onSuccess: put, // the socket event may arrive first; put() replaces by id, so no duplicate
  });
}

export function useDeleteTask() {
  return useMutation({
    mutationFn: (task: Task) => del(`/tasks/${task.id}`),
    onMutate: (task) => {
      drop(task.id);
      return { task };
    },
    onError: (_err, _task, context) => context && put(context.task),
  });
}
