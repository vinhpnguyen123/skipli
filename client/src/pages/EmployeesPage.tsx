import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { button, input } from '../components/ui';
import { EmployeeForm } from '../features/employees/EmployeeForm';
import {
  useDeleteEmployee,
  useEmployees,
  useResendInvite,
  type InviteResult,
} from '../features/employees/hooks';
import type { User } from '../lib/types';

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string };
type Modal =
  | { kind: 'add' }
  | { kind: 'edit'; employee: User }
  | { kind: 'delete'; employee: User }
  | { kind: 'invite'; name: string; url: string };

const STATUS: Record<User['status'], { label: string; className: string }> = {
  invited: { label: 'Invited', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  disabled: { label: 'Disabled', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const matches = (e: User, q: string) =>
  [e.name, e.email, e.phone ?? '', e.department, e.title].some((v) => v.toLowerCase().includes(q));

export default function EmployeesPage() {
  const employees = useEmployees();
  const remove = useDeleteEmployee();
  const resend = useResendInvite();
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const close = () => setModal(null);

  // Notices fade after a few seconds; errors stay until dismissed.
  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const data = employees.data;
  const list = data ?? [];
  // Existing departments, suggested in the form so names stay consistent.
  const departments = useMemo(
    () => [...new Set((data ?? []).map((e) => e.department))].sort(),
    [data],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((e) => matches(e, q)) : list;
  const invitedCount = list.filter((e) => e.status === 'invited').length;

  // After create/resend: demo mode hands back the link to copy; otherwise say whether the email went out.
  const afterInvite = (name: string, email: string, invite: InviteResult) => {
    if (invite.setupUrl) setModal({ kind: 'invite', name, url: invite.setupUrl });
    else close();
    setNotice(
      invite.inviteSent
        ? { tone: 'ok', text: `Invite sent to ${email}.` }
        : { tone: 'warn', text: `Couldn't email ${email}. Try "Resend invite" later.` },
    );
  };

  const onResend = (e: User) =>
    resend.mutate(e.id, {
      onSuccess: (invite) => afterInvite(e.name, e.email, invite),
      onError: (err) => setNotice({ tone: 'error', text: err.message }),
    });

  const onDelete = (e: User) =>
    remove.mutate(e.id, {
      onSuccess: () => {
        close();
        setNotice({ tone: 'ok', text: `${e.name} was deleted.` });
      },
    });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
          {employees.isSuccess && (
            <p className="mt-1 text-sm text-slate-500">
              {list.length} {list.length === 1 ? 'employee' : 'employees'}
              {invitedCount > 0 && ` · ${invitedCount} waiting to set up`}
            </p>
          )}
        </div>
        <button onClick={() => setModal({ kind: 'add' })} className={button.primary}>
          Add employee
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className={`mt-4 flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm ${
            {
              ok: 'bg-emerald-50 text-emerald-800',
              warn: 'bg-amber-50 text-amber-800',
              error: 'bg-red-50 text-red-700',
            }[notice.tone]
          }`}
        >
          <span>{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {list.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, department…"
          aria-label="Search employees"
          className={`${input} mt-6 max-w-sm`}
        />
      )}

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {employees.isPending ? (
          <p className="p-6 text-sm text-slate-500">Loading employees…</p>
        ) : employees.isError ? (
          <div className="p-6 text-sm">
            <p className="text-red-600">Couldn't load employees: {employees.error.message}</p>
            <button onClick={() => employees.refetch()} className={`${button.link} mt-2`}>
              Try again
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium text-slate-900">No employees yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add your first employee and they'll get an invite by email.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No employees match “{query}”.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="hidden px-4 py-3 md:table-cell">Email</th>
                <th className="hidden px-4 py-3 lg:table-cell">Phone</th>
                <th className="hidden px-4 py-3 sm:table-cell">Department</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{e.name}</div>
                    <div className="text-xs text-slate-500">
                      {e.title}
                      {/* Email moves under the name on small screens. */}
                      <span className="md:hidden">
                        {e.title && ' · '}
                        {e.email}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{e.email}</td>
                  <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                    {e.phone ?? '—'}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">{e.department}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS[e.status].className}`}
                    >
                      {STATUS[e.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-x-4 gap-y-1">
                      {e.status === 'invited' && (
                        <button
                          onClick={() => onResend(e)}
                          disabled={resend.isPending && resend.variables === e.id}
                          className={button.link}
                        >
                          {resend.isPending && resend.variables === e.id
                            ? 'Sending…'
                            : 'Resend invite'}
                        </button>
                      )}
                      <button
                        onClick={() => setModal({ kind: 'edit', employee: e })}
                        className={button.link}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          remove.reset(); // a previous attempt's error shouldn't show
                          setModal({ kind: 'delete', employee: e });
                        }}
                        className="text-sm font-medium text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={modal?.kind === 'add'} onClose={close} title="Add employee">
        <EmployeeForm
          departments={departments}
          onCancel={close}
          onSaved={({ name, email, invite }) => afterInvite(name, email, invite!)}
        />
      </Dialog>

      <Dialog open={modal?.kind === 'edit'} onClose={close} title="Edit employee">
        {modal?.kind === 'edit' && (
          <EmployeeForm
            employee={modal.employee}
            departments={departments}
            onCancel={close}
            onSaved={({ name }) => {
              close();
              setNotice({ tone: 'ok', text: `Saved changes to ${name}.` });
            }}
          />
        )}
      </Dialog>

      <Dialog open={modal?.kind === 'delete'} onClose={close} title="Delete employee?">
        {modal?.kind === 'delete' && (
          <>
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-900">{modal.employee.name}</span> will be
              removed and signed out everywhere. This can't be undone. Activity history keeps their
              name.
            </p>
            {remove.error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {remove.error.message}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={close} className={button.secondary}>
                Cancel
              </button>
              <button
                onClick={() => onDelete(modal.employee)}
                disabled={remove.isPending}
                className={button.danger}
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog open={modal?.kind === 'invite'} onClose={close} title="Invite link">
        {modal?.kind === 'invite' && (
          <InviteLink name={modal.name} url={modal.url} onDone={close} />
        )}
      </Dialog>
    </div>
  );
}

// Demo mode only: the server hands the setup link back so it can be shared without real email.
function InviteLink({ name, url, onDone }: { name: string; url: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // clipboard blocked: the field is selectable
    }
  };

  return (
    <>
      <p className="text-sm text-slate-600">
        Demo mode: share this link with <span className="font-medium text-slate-900">{name}</span>{' '}
        to set up their account. It works once and expires in 48 hours.
      </p>
      <div className="mt-4 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          aria-label="Setup link"
          className={`${input} mt-0 font-mono text-xs`}
        />
        <button onClick={copy} className={`${button.secondary} shrink-0`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-6 flex justify-end">
        <button onClick={onDone} className={button.primary}>
          Done
        </button>
      </div>
    </>
  );
}
