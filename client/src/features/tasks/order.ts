// A card's position is a number between its neighbours, so a move updates one task instead of renumbering
// the column. New tasks start at their creation time in ms, leaving whole seconds of room between them.
// ponytail: repeated drops into the exact same gap halve it ~40 times before two cards share a number; add a
// "renumber this column" step if that ever happens in practice.
const STEP = 1000;

export function orderBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return Date.now();
  if (before === undefined) return after! - STEP;
  if (after === undefined) return before + STEP;
  return (before + after) / 2;
}
