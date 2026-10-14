import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthCard, FormError } from '../components/AuthCard';
import { button, input } from '../components/ui';
import { ApiError, post } from '../lib/api';

const USERNAME_RULE = /^[a-z0-9._-]{3,30}$/i;

export default function SetupPage() {
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') ?? '';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const check = useQuery({
    queryKey: ['setup', token],
    queryFn: () => post<{ name: string; email: string }>('/employee/setup/check', { token }),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });

  const setup = useMutation({
    mutationFn: () => post<{ username: string }>('/employee/setup', { token, username, password }),
    onSuccess: (res) => navigate('/login', { replace: true, state: { username: res.username } }),
  });

  // Checked here for instant feedback; the server enforces the same rules.
  const problems = {
    username: USERNAME_RULE.test(username.trim())
      ? null
      : '3–30 characters: letters, numbers, dots, dashes, underscores',
    password: password.length >= 8 ? null : 'At least 8 characters',
    confirm: confirm === password ? null : "Passwords don't match",
  };
  const usernameTaken = setup.error instanceof ApiError && setup.error.code === 'CONFLICT';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(problems).some(Boolean)) return;
    setup.mutate();
  };

  if (!token || check.isError) {
    const err = check.error;
    const used = err instanceof ApiError && err.code === 'LINK_USED';
    return (
      <AuthCard title={used ? 'Already set up' : 'Link not valid'}>
        <p className="mt-4 text-sm text-slate-600">
          {err?.message ??
            'This page needs the link from your invite email. Open it again from the email.'}
        </p>
        <Link to="/login" className={`${button.primary} mt-6 block text-center`}>
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  if (check.isPending) {
    return (
      <AuthCard title="Set up your account">
        <p className="mt-4 text-sm text-slate-500">Checking your invite…</p>
      </AuthCard>
    );
  }

  const fieldError = (name: keyof typeof problems) => touched && problems[name];

  return (
    <AuthCard title="Set up your account">
      <p className="mt-2 text-sm text-slate-500">
        Welcome, <span className="font-medium text-slate-700">{check.data.name}</span>. Choose how
        you'll sign in to <span className="font-medium text-slate-700">{check.data.email}</span>.
      </p>
      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Username</span>
          <input
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={!!fieldError('username') || usernameTaken}
            className={input}
          />
          <span
            className={`mt-1 block text-xs ${fieldError('username') || usernameTaken ? 'text-red-600' : 'text-slate-500'}`}
          >
            {usernameTaken
              ? 'That username is taken'
              : '3–30 characters: letters, numbers, dots, dashes, underscores'}
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldError('password')}
            className={input}
          />
          <span
            className={`mt-1 block text-xs ${fieldError('password') ? 'text-red-600' : 'text-slate-500'}`}
          >
            At least 8 characters
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!fieldError('confirm')}
            className={input}
          />
          {fieldError('confirm') && (
            <span className="mt-1 block text-xs text-red-600">{problems.confirm}</span>
          )}
        </label>
        <button type="submit" disabled={setup.isPending} className={`${button.primary} w-full`}>
          {setup.isPending ? 'Creating account…' : 'Create account'}
        </button>
        {!usernameTaken && <FormError error={setup.error} />}
      </form>
    </AuthCard>
  );
}
