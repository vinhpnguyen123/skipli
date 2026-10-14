import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { FormError } from '../../components/AuthCard';
import { button, input } from '../../components/ui';
import { post } from '../../lib/api';
import type { SessionResponse } from '../../lib/types';

export function PasswordLogin({
  initialUsername = '',
  onSignedIn,
}: {
  initialUsername?: string;
  onSignedIn: (session: SessionResponse) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => post<SessionResponse>('/employee/login', { username, password }),
    onSuccess: onSignedIn,
    onError: () => setPassword(''),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Username</span>
        <input
          autoComplete="username"
          autoCapitalize="none"
          required
          autoFocus={!initialUsername}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={input}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          autoFocus={!!initialUsername}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </label>
      <button type="submit" disabled={login.isPending} className={`${button.primary} w-full`}>
        {login.isPending ? 'Signing in…' : 'Sign in'}
      </button>
      <FormError error={login.error} />
    </form>
  );
}
