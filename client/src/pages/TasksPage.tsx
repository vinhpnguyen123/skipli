import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog } from '../components/Dialog';
import { NoticeBanner } from '../components/Notice';
import { useNotice } from '../components/useNotice';
import { button, toolbarSelect } from '../components/ui';
import { useEmployees } from '../features/employees/hooks';
import { Board, type SortBy } from '../features/tasks/Board';
import { COLUMNS } from '../features/tasks/columns';
import { dueState, formatDue, useNow } from '../features/tasks/due';
import { TaskCard } from '../features/tasks/TaskCard';
import { TaskForm } from '../features/tasks/TaskForm';
import {
  isConflict,
  useTaskEvents,
  useTasks,
  useUpdateTask,
  type TaskChanges,
} from '../features/tasks/hooks';
import type { Task, User } from '../lib/types';

type Modal = { kind: 'new' } | { kind: 'open'; taskId: string };

export default function TasksPage({ user }: { user: User }) {
  const isOwner = user.role === 'owner';
  const tasks = useTasks();
  const employees = useEmployees(isOwner);
  const update = useUpdateTask();
  const [notice, setNotice] = useNotice();
  const [filter, setFilter] = useState('all'); // 'all' | 'none' | employee id
  const [modal, setModal] = useState<Modal | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('manual');
  // Notification links open a task: /?task=<id>.
  const [params, setParams] = useSearchParams();
  const linkedTaskId = params.get('task');
  const now = useNow();
  useTaskEvents(user);

  const staff = useMemo(() => employees.data ?? [], [employees.data]);
  const names = useMemo(() => new Map(staff.map((e) => [e.id, e.name])), [staff]);
  const all = tasks.data ?? [];
  const shown =
    filter === 'all'
      ? all
      : all.filter((t) => (filter === 'none' ? !t.assigneeId : t.assigneeId === filter));
  // Looked up live, so an open dialog reflects socket updates and closes if the task is deleted.
  const openId = modal?.kind === 'open' ? modal.taskId : modal ? undefined : linkedTaskId;
  const openTask = openId ? all.find((t) => t.id === openId) : undefined;
  const close = () => {
    setModal(null);
    if (linkedTaskId) setParams({}, { replace: true });
  };

  const change = (task: Task, changes: TaskChanges, success?: string) =>
    update.mutate(
      { task, changes },
      {
        onSuccess: () => success && setNotice({ tone: 'ok', text: success }),
        onError: (err) =>
          setNotice(
            isConflict(err)
              ? {
                  tone: 'warn',
                  text: `"${task.title}" was just changed by someone else. Showing the latest version.`,
                }
              : { tone: 'error', text: `Couldn't update "${task.title}": ${err.message}` },
          ),
      },
    );

  const unassignedCount = all.filter((t) => !t.assigneeId).length;
  const overdueCount = all.filter((t) => dueState(t, now) === 'overdue').length;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {isOwner ? 'Tasks' : 'My tasks'}
          </h1>
          {tasks.isSuccess && (
            <p className="mt-1 text-sm text-slate-500">
              {all.filter((t) => t.status !== 'done').length} open ·{' '}
              {all.filter((t) => t.status === 'done').length} done
              {isOwner && unassignedCount > 0 && ` · ${unassignedCount} unassigned`}
              {overdueCount > 0 && (
                <span className="font-medium text-red-700"> · {overdueCount} overdue</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort cards by"
            className={toolbarSelect}
          >
            <option value="manual">Manual order</option>
            <option value="due">Due date</option>
          </select>
          {isOwner && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Show tasks for"
              className={toolbarSelect}
            >
              <option value="all">Everyone</option>
              <option value="none">Unassigned</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          {isOwner && (
            <button onClick={() => setModal({ kind: 'new' })} className={button.primary}>
              New task
            </button>
          )}
        </div>
      </div>

      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />

      <div className="mt-6">
        {tasks.isPending ? (
          <p className="text-sm text-slate-500">Loading tasks…</p>
        ) : tasks.isError ? (
          <div className="text-sm">
            <p className="text-red-600">Couldn't load tasks: {tasks.error.message}</p>
            <button onClick={() => tasks.refetch()} className={`${button.link} mt-2`}>
              Try again
            </button>
          </div>
        ) : all.length === 0 ? (
          <div className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200">
            <p className="font-medium text-slate-900">
              {isOwner ? 'No tasks yet' : 'Nothing assigned to you yet'}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {isOwner
                ? 'Create a task and assign it to someone. They see it on their board right away.'
                : 'Tasks your manager assigns to you will show up here.'}
            </p>
            {isOwner && (
              <button
                onClick={() => setModal({ kind: 'new' })}
                className={`${button.primary} mt-4`}
              >
                New task
              </button>
            )}
          </div>
        ) : (
          <Board
            tasks={shown}
            sortBy={sortBy}
            onMove={(task, changes) => change(task, changes)}
            renderCard={(task) => (
              <TaskCard
                task={task}
                viewer={user}
                now={now}
                assigneeName={task.assigneeId ? names.get(task.assigneeId) : undefined}
                employees={staff}
                onOpen={() => setModal({ kind: 'open', taskId: task.id })}
                onMarkDone={() => change(task, { status: 'done' }, `Marked "${task.title}" done.`)}
                onAssign={(assigneeId) =>
                  change(
                    task,
                    { assigneeId },
                    `Assigned "${task.title}" to ${names.get(assigneeId)}.`,
                  )
                }
              />
            )}
          />
        )}
      </div>

      <Dialog open={modal?.kind === 'new'} onClose={close} title="New task">
        <TaskForm
          employees={staff}
          onCancel={close}
          onDone={(text) => {
            close();
            setNotice({ tone: 'ok', text });
          }}
        />
      </Dialog>

      <Dialog open={!!openTask} onClose={close} title={isOwner ? 'Edit task' : 'Task'}>
        {openTask &&
          (isOwner ? (
            // Keyed by version: if someone else saves while this is open, the form reloads their changes.
            <TaskForm
              key={openTask.version}
              task={openTask}
              employees={staff}
              onCancel={close}
              onDone={(text) => {
                close();
                setNotice({ tone: 'ok', text });
              }}
            />
          ) : (
            <EmployeeTaskView
              task={openTask}
              onMove={(status) => change(openTask, { status })}
              onClose={close}
            />
          ))}
      </Dialog>
    </div>
  );
}

// Employees can read the details and move their own task between columns.
function EmployeeTaskView({
  task,
  onMove,
  onClose,
}: {
  task: Task;
  onMove: (status: Task['status']) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <p className="font-medium text-slate-900">{task.title}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
        {task.description || 'No description.'}
      </p>
      {task.dueDate && (
        <p className="mt-3 text-sm text-slate-700">
          Due <time dateTime={task.dueDate}>{formatDue(task.dueDate)}</time>
        </p>
      )}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-slate-700">Status</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {COLUMNS.map((c) => (
            <button
              key={c.status}
              onClick={() => c.status !== task.status && onMove(c.status)}
              aria-pressed={task.status === c.status}
              className={
                task.status === c.status
                  ? 'rounded-lg bg-blue-600 px-2 py-2 text-sm font-medium text-white'
                  : 'rounded-lg bg-white px-2 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="mt-6 flex justify-end">
        <button onClick={onClose} className={button.secondary}>
          Close
        </button>
      </div>
    </div>
  );
}
