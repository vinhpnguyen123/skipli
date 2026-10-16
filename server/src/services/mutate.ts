import type { Transaction } from 'firebase-admin/firestore';
import { db } from '../lib/firebase.js';
import { emitTo } from '../socket/index.js';
import { recordActivity, type ActivityEntry } from './activity.js';

export type Emit = { to: string[]; event: string; data: unknown };

type Outcome<T> = {
  result: T;
  // Written in the same transaction as the change, so both commit or neither does.
  activity?: ActivityEntry;
  // Sent only after the commit succeeds, so clients never hear about a change that rolled back.
  emit?: Emit[];
};

// The one path for changing data: `work` does the reads, authorization checks and writes inside a
// transaction (input is already validated by the route); mutate adds the activity entry, commits,
// then notifies sockets. Throwing inside `work` aborts everything.
export async function mutate<T>(work: (tx: Transaction) => Promise<Outcome<T>>): Promise<T> {
  const { result, emit = [] } = await db.runTransaction(async (tx) => {
    const outcome = await work(tx);
    if (!outcome.activity) return outcome;
    // A retried transaction runs work again, so the emit list is rebuilt from this attempt only.
    const activity = recordActivity(tx, outcome.activity);
    const live: Emit[] =
      activity.visibility === 'feed'
        ? [{ to: ['owner'], event: 'activity:new', data: activity }]
        : [];
    return { ...outcome, emit: [...(outcome.emit ?? []), ...live] };
  });
  for (const e of emit) emitTo(e.to, e.event, e.data);
  return result;
}
