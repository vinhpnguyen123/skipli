import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useLogout, useSession } from './features/auth/session';
import { socket } from './lib/socket';
import type { User } from './lib/types';
import LoginPage from './pages/LoginPage';

export default function App() {
  const session = useSession();
  const user = session.data;
  const userId = user?.id;

  // One socket per signed-in user; dropped on sign-out.
  useEffect(() => {
    if (!userId) return;
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [userId]);

  if (session.isPending) return <p className="p-8 text-sm text-slate-500">Loading…</p>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/" element={user ? <Home user={user} /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// ponytail: placeholder until the owner dashboard lands in phase 2.
function Home({ user }: { user: User }) {
  const logout = useLogout();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on).on('disconnect', off);
    return () => {
      socket.off('connect', on).off('disconnect', off);
    };
  }, []);

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Hi, {user.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in as {user.role} · realtime {connected ? 'connected' : 'offline'}
      </p>
      <button
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="mt-6 rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
      >
        Sign out
      </button>
    </main>
  );
}
