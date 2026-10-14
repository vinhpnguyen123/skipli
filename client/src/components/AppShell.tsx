import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useLogout } from '../features/auth/session';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { socket } from '../lib/socket';
import type { User } from '../lib/types';

function useSocketConnected() {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on).on('disconnect', off);
    return () => {
      socket.off('connect', on).off('disconnect', off);
    };
  }, []);
  return connected;
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:text-slate-900'}`;

export function AppShell({ user }: { user: User }) {
  const logout = useLogout();
  const connected = useSocketConnected();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <span className="font-semibold text-slate-900">Skipli</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              Tasks
            </NavLink>
            {user.role === 'owner' && (
              <NavLink to="/employees" className={navClass}>
                Employees
              </NavLink>
            )}
            <NavLink to="/profile" className={navClass}>
              Profile
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span
              className="flex items-center gap-1.5 text-xs text-slate-500"
              title={connected ? 'Realtime connected' : 'Realtime offline'}
            >
              <span
                className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`}
              />
              <span className="hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
            </span>
            <NotificationBell />
            <span className="hidden text-sm text-slate-700 sm:inline">{user.name}</span>
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
