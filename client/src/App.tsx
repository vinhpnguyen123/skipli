import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { socket } from './lib/socket';

export default function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api<{ ok: boolean }>('/health'),
  });
  const [pong, setPong] = useState<string>();

  useEffect(() => {
    socket.emit('ping:check', (reply: string) => setPong(reply));
  }, []);

  return (
    <main className="mx-auto max-w-md p-8 font-sans">
      <h1 className="text-2xl font-semibold">Skipli</h1>
      <ul className="mt-4 space-y-1 text-sm">
        <li>API: {health.isPending ? 'checking…' : health.isError ? `error — ${health.error.message}` : 'ok'}</li>
        <li>Socket: {pong ?? 'waiting…'}</li>
      </ul>
    </main>
  );
}
