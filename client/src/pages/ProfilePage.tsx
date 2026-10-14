import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { button, input } from '../components/ui';
import { api, fieldErrors, patch } from '../lib/api';
import { queryClient } from '../lib/query';
import type { User } from '../lib/types';

const FIELDS = ['name', 'email', 'phone'] as const;
type Field = (typeof FIELDS)[number];

export default function ProfilePage() {
  // Fresh from the server: the owner may have changed details since this session started.
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/me') });

  if (me.isPending) return <p className="text-sm text-slate-500">Loading your profile…</p>;
  if (me.isError) {
    return (
      <div className="text-sm">
        <p className="text-red-600">Couldn't load your profile: {me.error.message}</p>
        <button onClick={() => me.refetch()} className={`${button.link} mt-2`}>
          Try again
        </button>
      </div>
    );
  }
  // Keyed by id so the form resets if a different user's data ever loads here.
  return <Profile key={me.data.id} user={me.data} />;
}

function Profile({ user }: { user: User }) {
  const [values, setValues] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone ?? '',
  });
  const [saved, setSaved] = useState(false);

  // Only what changed; an empty phone means "remove it".
  const changes: Partial<Record<Field, string | null>> = {};
  if (values.name.trim() !== user.name) changes.name = values.name.trim();
  if (values.email.trim().toLowerCase() !== user.email) changes.email = values.email.trim();
  if ((values.phone.trim() || null) !== user.phone) changes.phone = values.phone.trim() || null;
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => patch<User>('/me', changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
      queryClient.setQueryData(['session'], updated); // header shows the new name right away
      setValues({ name: updated.name, email: updated.email, phone: updated.phone ?? '' });
      setSaved(true);
    },
  });
  const errors = fieldErrors(save.error, FIELDS);
  const generalError = save.error && !Object.keys(errors).length ? save.error.message : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty) save.mutate();
  };
  const set = (field: Field) => (e: { target: { value: string } }) => {
    setSaved(false);
    setValues((v) => ({ ...v, [field]: e.target.value }));
  };

  const field = (name: Field, label: string, hint: string | null, props: object) => (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={!!errors[name]}
        className={input}
        {...props}
      />
      {(errors[name] || hint) && (
        <span className={`mt-1 block text-xs ${errors[name] ? 'text-red-600' : 'text-slate-500'}`}>
          {errors[name] ?? hint}
        </span>
      )}
    </label>
  );

  const isOwner = user.role === 'owner';

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Your profile</h1>
      <p className="mt-1 text-sm text-slate-500">Keep your contact details up to date.</p>

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
      >
        {field('name', 'Full name', null, { required: true, maxLength: 100, autoComplete: 'name' })}
        {field('email', 'Email', isOwner ? null : 'Sign-in codes are sent here.', {
          type: 'email',
          required: true,
          maxLength: 254,
          autoComplete: 'email',
        })}
        {field(
          'phone',
          isOwner ? 'Phone' : 'Phone (optional)',
          isOwner ? 'You sign in with this number.' : null,
          {
            type: 'tel',
            required: isOwner,
            placeholder: '+1 555 555 0100',
            autoComplete: 'tel',
          },
        )}

        {generalError && (
          <p role="alert" className="text-sm text-red-600">
            {generalError}
          </p>
        )}
        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && !dirty && (
            <span role="status" className="text-sm text-emerald-700">
              Saved
            </span>
          )}
          <button type="submit" disabled={!dirty || save.isPending} className={button.primary}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      <section className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold text-slate-900">Account</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ['Role', isOwner ? 'Owner' : 'Employee'],
            ['Username', user.username ?? (isOwner ? 'Signs in by SMS' : '—')],
            ['Department', user.department || '—'],
            ['Title', user.title || '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        {!isOwner && (
          <p className="mt-4 text-xs text-slate-500">
            Your manager sets your department and title.
          </p>
        )}
      </section>
    </div>
  );
}
