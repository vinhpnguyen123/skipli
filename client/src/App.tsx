import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useSession } from './features/auth/session';
import { socket } from './lib/socket';
import type { User } from './lib/types';
import EmployeesPage from './pages/EmployeesPage';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';

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
        {/* Reachable signed in or out: an owner testing an invite link shouldn't be bounced away. */}
        <Route path="/setup" element={<SetupPage />} />
        {user ? (
          <Route element={<AppShell user={user} />}>
            <Route
              index
              element={user.role === 'owner' ? <EmployeesPage /> : <EmployeeHome user={user} />}
            />
          </Route>
        ) : (
          <Route index element={<Navigate to="/login" replace />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

// ponytail: placeholder until the profile page (2d) and tasks (phase 3).
function EmployeeHome({ user }: { user: User }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Hi, {user.name}</h1>
      <p className="mt-1 text-sm text-slate-500">Your tasks will show up here.</p>
    </div>
  );
}
