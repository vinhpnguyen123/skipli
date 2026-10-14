import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useMemo, useState, type ReactNode } from 'react';
import type { Task, TaskStatus } from '../../lib/types';
import { COLUMNS } from './columns';
import { orderBetween } from './order';

const COLUMN_PREFIX = 'column:';

type Props = {
  tasks: Task[];
  onMove: (task: Task, changes: { status: TaskStatus; order: number }) => void;
  renderCard: (task: Task, dragging: boolean) => ReactNode;
};

export function Board({ tasks, onMove, renderCard }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);

  // A small drag distance (or a press-and-hold on touch) so taps and clicks on a card still work.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = useMemo(() => {
    const byStatus: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const t of tasks) byStatus[t.status].push(t);
    for (const list of Object.values(byStatus)) list.sort((a, b) => a.order - b.order);
    return byStatus;
  }, [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const active = activeId ? byId.get(activeId) : undefined;

  // Over a column's empty space, or over a card in it.
  const statusAt = (overId: string): TaskStatus | undefined =>
    overId.startsWith(COLUMN_PREFIX)
      ? (overId.slice(COLUMN_PREFIX.length) as TaskStatus)
      : byId.get(overId)?.status;

  const onDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));
  const onDragOver = ({ over }: DragOverEvent) =>
    setOverStatus(over ? (statusAt(String(over.id)) ?? null) : null);
  const reset = () => {
    setActiveId(null);
    setOverStatus(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    reset();
    const task = byId.get(String(active.id));
    if (!task || !over) return;
    const overId = String(over.id);
    const status = statusAt(overId);
    if (!status) return;

    const column = columns[status];
    const others = column.filter((t) => t.id !== task.id);
    let index: number;
    if (overId.startsWith(COLUMN_PREFIX)) {
      index = others.length; // empty space: to the bottom
    } else {
      index = others.findIndex((t) => t.id === overId);
      // Within a column, dropping onto a card below moves past it (like dragging a list item down).
      const from = column.findIndex((t) => t.id === task.id);
      const to = column.findIndex((t) => t.id === overId);
      if (status === task.status && from === to) return; // dropped where it started
      if (status === task.status && from < to) index += 1;
    }
    onMove(task, { status, order: orderBetween(others[index - 1]?.order, others[index]?.order) });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'To move a task, press space or enter. Use the arrow keys to move it, then press space or enter again to drop it, or escape to cancel.',
        },
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map(({ status, label }) => (
          <Column
            key={status}
            status={status}
            label={label}
            count={columns[status].length}
            highlight={overStatus === status}
          >
            <SortableContext
              id={status}
              items={columns[status].map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {columns[status].map((task) => (
                <SortableCard key={task.id} id={task.id}>
                  {renderCard(task, task.id === activeId)}
                </SortableCard>
              ))}
            </SortableContext>
          </Column>
        ))}
      </div>
      <DragOverlay>
        {active ? <div className="rotate-1 shadow-lg">{renderCard(active, false)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  label,
  count,
  highlight,
  children,
}: {
  status: TaskStatus;
  label: string;
  count: number;
  highlight: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: `${COLUMN_PREFIX}${status}` });
  return (
    <section
      aria-label={label}
      className={`flex min-h-48 flex-col rounded-xl p-3 transition-colors ${highlight ? 'bg-blue-50 ring-2 ring-blue-200' : 'bg-slate-100'}`}
    >
      <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-slate-700">
        {label}
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
          {count}
        </span>
      </h2>
      <ul ref={setNodeRef} className="mt-3 flex flex-1 flex-col gap-2">
        {children}
        {count === 0 && (
          <li className="rounded-lg border-2 border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
            Drop tasks here
          </li>
        )}
      </ul>
    </section>
  );
}

function SortableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={`touch-manipulation rounded-lg focus-visible:outline-2 focus-visible:outline-blue-500 ${isDragging ? 'opacity-40' : ''}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </li>
  );
}
