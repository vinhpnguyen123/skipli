import { useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { NoticeBanner } from '../components/Notice';
import { useNotice } from '../components/useNotice';
import { button, input, toolbarSelect } from '../components/ui';
import { useEmployees } from '../features/employees/hooks';
import { useSaveSchedule, useScheduleEvents, useSchedules } from '../features/schedule/hooks';
import { ApiError } from '../lib/api';
import type { Shift, User } from '../lib/types';

// Monday first; dayOfWeek is 0 = Sunday like Date#getDay.
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_PX = 28;
// One color per employee, by their position in the (name-sorted) list; repeats after eight.
const COLORS = [
  'bg-blue-100 text-blue-900 ring-blue-300',
  'bg-emerald-100 text-emerald-900 ring-emerald-300',
  'bg-amber-100 text-amber-900 ring-amber-300',
  'bg-violet-100 text-violet-900 ring-violet-300',
  'bg-rose-100 text-rose-900 ring-rose-300',
  'bg-cyan-100 text-cyan-900 ring-cyan-300',
  'bg-lime-100 text-lime-900 ring-lime-300',
  'bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300',
];

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// Wall-clock time in the business's zone, written the viewer's way (9:00 AM / 09:00).
const label = (t: string) =>
  new Date(2000, 0, 1, 0, minutes(t)).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

type Block = Shift & { employeeId: string; index: number };
// index: position in that employee's shift list; absent = a new shift.
type Editing = { employeeId: string; index?: number; shift: Shift };

export default function SchedulePage({ user }: { user: User }) {
  const isOwner = user.role === 'owner';
  const schedules = useSchedules();
  const employees = useEmployees(isOwner);
  const save = useSaveSchedule();
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useNotice();
  useScheduleEvents();

  const staff = useMemo(
    () => (isOwner ? (employees.data ?? []) : [user]),
    [isOwner, employees.data, user],
  );
  const color = useMemo(
    () => new Map(staff.map((e, i) => [e.id, COLORS[i % COLORS.length]])),
    [staff],
  );
  const name = (id: string) => staff.find((e) => e.id === id)?.name ?? 'Former employee';
  const shiftsOf = (id: string) => schedules.data?.find((s) => s.employeeId === id)?.shifts ?? [];
  const timeZone = schedules.data?.[0]?.timeZone;

  const blocks: Block[] = (schedules.data ?? [])
    .filter((s) => filter === 'all' || s.employeeId === filter)
    .flatMap((s) =>
      s.shifts.map((shift, index) => ({ ...shift, employeeId: s.employeeId, index })),
    );
  const totalHours = blocks.reduce((sum, b) => sum + minutes(b.end) - minutes(b.start), 0) / 60;

  const close = () => {
    setEditing(null);
    save.reset();
  };

  // Replaces (or with null removes) one shift, or adds one, and saves the employee's whole week.
  const commit = (e: Editing, next: Shift | null) => {
    const list = [...shiftsOf(e.employeeId)];
    if (e.index === undefined) list.push(next!);
    else if (next) list[e.index] = next;
    else list.splice(e.index, 1);
    save.mutate(
      { employeeId: e.employeeId, shifts: list },
      {
        onSuccess: () => {
          close();
          setNotice({ tone: 'ok', text: `Saved ${name(e.employeeId)}'s schedule.` });
        },
      },
    );
  };

  // Clicking an empty spot in a day starts a 4-hour shift there, on the half hour.
  const addAt = (day: number, ev: MouseEvent<HTMLDivElement>) => {
    const employeeId = filter !== 'all' ? filter : staff[0]?.id;
    if (!employeeId) return;
    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
    const start = Math.min(47, Math.max(0, Math.floor(y / (HOUR_PX / 2)))) * 30;
    setEditing({
      employeeId,
      shift: { dayOfWeek: day, start: hhmm(start), end: hhmm(start + 240) },
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {isOwner ? 'Schedule' : 'My schedule'}
          </h1>
          {schedules.isSuccess && (
            <p className="mt-1 text-sm text-slate-500">
              {totalHours.toLocaleString()} hours a week
              {timeZone && ` · Times in ${timeZone.replace(/_/g, ' ')}`}
            </p>
          )}
        </div>
        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Show schedule for"
              className={toolbarSelect}
            >
              <option value="all">Everyone</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setEditing({
                  employeeId: filter !== 'all' ? filter : (staff[0]?.id ?? ''),
                  shift: { dayOfWeek: 1, start: '09:00', end: '17:00' },
                })
              }
              disabled={!staff.length}
              className={button.primary}
            >
              Add shift
            </button>
          </div>
        )}
      </div>

      <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />

      {isOwner && filter === 'all' && staff.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 text-xs">
          {staff.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => setFilter(e.id)}
                className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${color.get(e.id)}`}
              >
                {e.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {schedules.isPending || (isOwner && employees.isPending) ? (
          <p className="p-6 text-sm text-slate-500">Loading schedule…</p>
        ) : schedules.isError ? (
          <div className="p-6 text-sm">
            <p className="text-red-600">Couldn't load the schedule: {schedules.error.message}</p>
            <button onClick={() => schedules.refetch()} className={`${button.link} mt-2`}>
              Try again
            </button>
          </div>
        ) : isOwner && !staff.length ? (
          <p className="p-10 text-center text-sm text-slate-500">
            Add employees to plan their week.
          </p>
        ) : (
          <>
            {!blocks.length && (
              <p className="border-b border-slate-100 px-4 py-3 text-sm text-slate-500">
                {isOwner
                  ? 'No shifts yet. Click a day to add one.'
                  : 'No shifts scheduled. Your manager sets your hours here.'}
              </p>
            )}
            <div className="grid min-w-[44rem] grid-cols-[3.5rem_repeat(7,1fr)]">
              <div />
              {DAYS.map((d) => (
                <div
                  key={d}
                  className="border-b border-l border-slate-200 py-2 text-center text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  <span className="sm:hidden">{DAY_NAMES[d].slice(0, 2)}</span>
                  <span className="hidden sm:inline">{DAY_NAMES[d].slice(0, 3)}</span>
                </div>
              ))}
              <div className="relative" style={{ height: HOUR_PX * 24 }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <span
                    key={i}
                    className="absolute right-2 -translate-y-1/2 text-[10px] text-slate-400"
                    style={{ top: i * 2 * HOUR_PX }}
                  >
                    {i > 0 && label(hhmm(i * 120))}
                  </span>
                ))}
              </div>
              {DAYS.map((d) => (
                <DayColumn
                  key={d}
                  blocks={blocks.filter((b) => b.dayOfWeek === d)}
                  laneOrder={staff.map((e) => e.id)}
                  color={(id) => color.get(id) ?? COLORS[0]}
                  name={name}
                  onAdd={isOwner ? (ev) => addAt(d, ev) : undefined}
                  onOpen={
                    isOwner
                      ? (b) =>
                          setEditing({
                            employeeId: b.employeeId,
                            index: b.index,
                            shift: { dayOfWeek: b.dayOfWeek, start: b.start, end: b.end },
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog
        open={!!editing}
        onClose={close}
        title={editing?.index === undefined ? 'Add shift' : 'Edit shift'}
      >
        {editing && (
          <ShiftForm
            editing={editing}
            staff={staff}
            // A rejected week says why (overlap, no length) in the details.
            error={
              save.error instanceof ApiError
                ? (save.error.details[0]?.message ?? save.error.message)
                : save.error?.message
            }
            saving={save.isPending}
            onCancel={close}
            onSave={(employeeId, shift) => commit({ ...editing, employeeId }, shift)}
            onDelete={() => commit(editing, null)}
          />
        )}
      </Dialog>
    </div>
  );
}

// Shifts of different people at the same time sit side by side: one lane per person working that day.
function DayColumn({
  blocks,
  laneOrder,
  color,
  name,
  onAdd,
  onOpen,
}: {
  blocks: Block[];
  laneOrder: string[];
  color: (employeeId: string) => string;
  name: (employeeId: string) => string;
  onAdd?: (ev: MouseEvent<HTMLDivElement>) => void;
  onOpen?: (b: Block) => void;
}) {
  const lanes = [...new Set(blocks.map((b) => b.employeeId))].sort(
    (a, b) => laneOrder.indexOf(a) - laneOrder.indexOf(b),
  );
  return (
    <div
      onClick={onAdd}
      className={`relative border-l border-slate-200 bg-[linear-gradient(to_bottom,var(--color-slate-100)_1px,transparent_1px)] ${onAdd ? 'cursor-copy' : ''}`}
      style={{ height: HOUR_PX * 24, backgroundSize: `100% ${HOUR_PX * 2}px` }}
    >
      {blocks.map((b) => {
        const lane = lanes.indexOf(b.employeeId);
        const top = (minutes(b.start) / 60) * HOUR_PX;
        const height = ((minutes(b.end) - minutes(b.start)) / 60) * HOUR_PX;
        const text = `${name(b.employeeId)}, ${label(b.start)}–${label(b.end)}`;
        const style = {
          top,
          height,
          left: `${(lane / lanes.length) * 100}%`,
          width: `${100 / lanes.length}%`,
        };
        const body = (
          <>
            <span className="block truncate font-medium">{name(b.employeeId)}</span>
            <span className="block truncate">
              {label(b.start)}–{label(b.end)}
            </span>
          </>
        );
        const cls = `absolute overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight ring-1 ring-inset ${color(b.employeeId)}`;
        return onOpen ? (
          <button
            key={`${b.employeeId}-${b.index}`}
            onClick={(ev) => {
              ev.stopPropagation(); // not a click on the empty day
              onOpen(b);
            }}
            title={text}
            aria-label={`Edit shift: ${text}`}
            className={`${cls} hover:brightness-95`}
            style={style}
          >
            {body}
          </button>
        ) : (
          <div key={`${b.employeeId}-${b.index}`} title={text} className={cls} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function ShiftForm({
  editing,
  staff,
  error,
  saving,
  onCancel,
  onSave,
  onDelete,
}: {
  editing: Editing;
  staff: User[];
  error?: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (employeeId: string, shift: Shift) => void;
  onDelete: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(editing.employeeId);
  const [day, setDay] = useState(editing.shift.dayOfWeek);
  const [start, setStart] = useState(editing.shift.start);
  // A shift running to midnight is stored as 24:00; the time input wants 00:00.
  const [end, setEnd] = useState(editing.shift.end === '24:00' ? '00:00' : editing.shift.end);
  const isNew = editing.index === undefined;
  const overnight = end <= start && start !== end;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(employeeId, { dayOfWeek: day, start, end });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {isNew && (
        <label className="block text-sm font-medium text-slate-700">
          Employee
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={input}
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Day
        <select value={day} onChange={(e) => setDay(Number(e.target.value))} className={input}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {DAY_NAMES[d]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">
          Start
          <input
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={input}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          End
          <input
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={input}
          />
        </label>
      </div>
      {overnight && (
        <p className="text-xs text-slate-500">
          Ends after midnight: saved as two shifts, {DAY_NAMES[day]} and {DAY_NAMES[(day + 1) % 7]}.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 pt-2">
        {!isNew ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="text-sm font-medium text-red-600 hover:underline"
          >
            Delete shift
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className={button.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={button.primary}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </form>
  );
}
