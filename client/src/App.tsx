import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useSession } from './features/auth/session';
import { socket } from './lib/socket';
import ChatPage from './pages/ChatPage';
import EmployeesPage from './pages/EmployeesPage';
import LoginPage from './pages/LoginPage';
import ProfilePage from './pages/ProfilePage';
import SetupPage from './pages/SetupPage';
import TasksPage from './pages/TasksPage';

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
            <Route index element={<TasksPage user={user} />} />
            {user.role === 'owner' && <Route path="employees" element={<EmployeesPage />} />}
            <Route path="chat" element={<ChatPage user={user} />} />
            <Route path="chat/:id" element={<ChatPage user={user} />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        ) : (
          <Route index element={<Navigate to="/login" replace />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
