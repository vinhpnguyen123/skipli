import type { Task, User } from '../../lib/types';

type Props = {
  task: Task;
  viewer: User;
  assigneeName?: string; // owner's board only
  employees?: User[]; // owner's board: quick-assign for unassigned tasks
  onOpen: () => void;
  onMarkDone: () => void;
  onAssign: (employeeId: string) => void;
};

// Keeps clicks and key presses on a control inside a draggable card from starting a drag.
const stop = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
};

export function TaskCard({
  task,
  viewer,
  assigneeName,
  employees,
  onOpen,
  onMarkDone,
  onAssign,
}: Props) {
  const isOwner = viewer.role === 'owner';
  const done = task.status === 'done';

  return (
    <article className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <button
        {...stop}
        onClick={onOpen}
        className={`block w-full text-left text-sm font-medium hover:text-blue-700 ${done ? 'text-slate-500 line-through' : 'text-slate-900'}`}
      >
        {task.title}
      </button>
      {task.description && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {isOwner &&
          (task.assigneeId ? (
            <span className="truncate text-xs text-slate-600">
              {assigneeName ?? 'Former employee'}
            </span>
          ) : (
            <select
              {...stop}
              aria-label={`Assign "${task.title}"`}
              value=""
              onChange={(e) => onAssign(e.target.value)}
              className="rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-600"
            >
              <option value="" disabled>
                Assign…
              </option>
              {employees?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          ))}
        {!isOwner && !done && (
          <button
            {...stop}
            onClick={onMarkDone}
            className="ml-auto rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
          >
            Mark done
          </button>
        )}
      </div>
    </article>
  );
}
