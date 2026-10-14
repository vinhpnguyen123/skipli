import { useState, type FormEvent } from 'react';
import { button, input } from '../../components/ui';
import { fieldErrors } from '../../lib/api';
import type { Task, TaskStatus, User } from '../../lib/types';
import { COLUMNS } from './columns';
import { fromLocalInput, toLocalInput } from './due';
import { isConflict, useCreateTask, useDeleteTask, useUpdateTask } from './hooks';

type Props = {
  task?: Task; // edit when set, create otherwise
  employees: User[];
  onDone: (message: string) => void;
  onCancel: () => void;
};

const FIELDS = ['title', 'description', 'assigneeId', 'dueDate'] as const;

// Owner only: create, edit, reassign, move, delete.
export function TaskForm({ task, employees, onDone, onCancel }: Props) {
  const [values, setValues] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    assigneeId: task?.assigneeId ?? '',
    dueDate: toLocalInput(task?.dueDate ?? null),
    status: task?.status ?? ('todo' as TaskStatus),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const mutation = task ? update : create;
  const errors = fieldErrors(mutation.error, FIELDS);
  const generalError =
    mutation.error && !Object.keys(errors).length
      ? isConflict(mutation.error)
        ? 'Someone else changed this task while you were editing. Close and reopen it to see the latest version.'
        : mutation.error.message
      : (remove.error?.message ?? null);

  const set = (field: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const fields = {
      title: values.title.trim(),
      description: values.description.trim(),
      assigneeId: values.assigneeId || null,
      dueDate: fromLocalInput(values.dueDate),
    };
    if (!task) {
      create.mutate(fields, { onSuccess: (t) => onDone(`Created "${t.title}".`) });
      return;
    }
    // Only what changed, so an untouched field can't clobber someone else's edit.
    const changes = Object.fromEntries(
      Object.entries({ ...fields, status: values.status }).filter(
        ([k, v]) => v !== task[k as keyof Task],
      ),
    );
    if (!Object.keys(changes).length) return onCancel();
    update.mutate({ task, changes }, { onSuccess: (t) => onDone(`Saved "${t.title}".`) });
  };

  const onDelete = () =>
    task && remove.mutate(task, { onSuccess: () => onDone(`Deleted "${task.title}".`) });

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Title</span>
        <input
          required
          maxLength={200}
          autoFocus
          value={values.title}
          onChange={set('title')}
          aria-invalid={!!errors.title}
          className={input}
        />
        {errors.title && <span className="mt-1 block text-xs text-red-600">{errors.title}</span>}
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Description (optional)</span>
        <textarea
          rows={3}
          maxLength={5000}
          value={values.description}
          onChange={set('description')}
          className={input}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Due (optional)</span>
        <span className="mt-1 flex gap-2">
          <input
            type="datetime-local"
            value={values.dueDate}
            onChange={set('dueDate')}
            aria-invalid={!!errors.dueDate}
            className={`${input} mt-0`}
          />
          {values.dueDate && (
            <button
              type="button"
              onClick={() => setValues((v) => ({ ...v, dueDate: '' }))}
              className={`${button.secondary} shrink-0`}
            >
              Clear
            </button>
          )}
        </span>
        {errors.dueDate && (
          <span className="mt-1 block text-xs text-red-600">{errors.dueDate}</span>
        )}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Assignee</span>
          <select
            value={values.assigneeId}
            onChange={set('assigneeId')}
            aria-invalid={!!errors.assigneeId}
            className={input}
          >
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {errors.assigneeId && (
            <span className="mt-1 block text-xs text-red-600">{errors.assigneeId}</span>
          )}
        </label>
        {task && (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Status</span>
            <select value={values.status} onChange={set('status')} className={input}>
              {COLUMNS.map((c) => (
                <option key={c.status} value={c.status}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {generalError && (
        <p role="alert" className="text-sm text-red-600">
          {generalError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        {task ? (
          confirmDelete ? (
            <span className="flex items-center gap-2 text-sm">
              Delete this task?
              <button
                type="button"
                onClick={onDelete}
                disabled={remove.isPending}
                className={button.danger}
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={button.link}>
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Delete task
            </button>
          )
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={button.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending} className={button.primary}>
            {mutation.isPending ? 'Saving…' : task ? 'Save' : 'Create task'}
          </button>
        </div>
      </div>
    </form>
  );
}
