import { useState } from 'react';
import { toolbarSelect } from '../components/ui';
import { ActivityList } from '../features/activity/ActivityList';

// Owner only: the full log. "Audit" holds security events (sign-ins, failed codes, resent invites).
export default function ActivityPage() {
  const [visibility, setVisibility] = useState<'all' | 'feed' | 'audit'>('all');
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Activity log</h1>
          <p className="mt-1 text-sm text-slate-500">Everything that happened, newest first.</p>
        </div>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          aria-label="Show"
          className={toolbarSelect}
        >
          <option value="all">Everything</option>
          <option value="feed">Team activity</option>
          <option value="audit">Security and sign-ins</option>
        </select>
      </div>
      <div className="mt-6 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <ActivityList visibility={visibility} limit={30} paged />
      </div>
    </div>
  );
}
