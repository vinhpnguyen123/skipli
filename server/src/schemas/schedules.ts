import { z } from 'zod';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
// Stored overnight halves end at '24:00', and the client sends the stored week back on every edit.
const endTime = z.union([time, z.literal('24:00')]);
const shift = z
  .object({ dayOfWeek: z.number().int().min(0).max(6), start: time, end: endTime })
  .strict();
export type Shift = { dayOfWeek: number; start: string; end: string };

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Local time in BUSINESS_TZ. An end at or before the start runs past midnight and is stored as two shifts:
// start–24:00 on its day and 00:00–end on the next (Saturday wraps to Sunday). Stored shifts are sorted and
// never overlap, so the grid draws them as they are.
export function normalizeShifts(input: Shift[]): Shift[] {
  const out: Shift[] = [];
  for (const s of input) {
    if (s.end > s.start) out.push(s);
    else {
      out.push({ ...s, end: '24:00' });
      if (s.end !== '00:00')
        out.push({ dayOfWeek: (s.dayOfWeek + 1) % 7, start: '00:00', end: s.end });
    }
  }
  return out.sort((a, b) => a.dayOfWeek - b.dayOfWeek || minutes(a.start) - minutes(b.start));
}

export const scheduleSchema = z
  .object({ shifts: z.array(shift).max(50) })
  .strict()
  .transform(({ shifts }, ctx) => {
    for (const [i, s] of shifts.entries())
      if (s.start === s.end)
        ctx.addIssue({
          code: 'custom',
          path: ['shifts', i, 'end'],
          message: 'Shift has no length',
        });
    const sorted = normalizeShifts(shifts);
    const overlaps = sorted.some(
      (cur, i) =>
        i > 0 &&
        sorted[i - 1].dayOfWeek === cur.dayOfWeek &&
        minutes(cur.start) < minutes(sorted[i - 1].end),
    );
    if (overlaps) ctx.addIssue({ code: 'custom', path: ['shifts'], message: 'Shifts overlap' });
    return { shifts: sorted };
  });
