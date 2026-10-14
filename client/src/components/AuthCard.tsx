import type { ReactNode } from 'react';

// Centered card shared by the sign-in and account-setup screens.
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function FormError({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 text-sm text-red-600">
      {error.message}
    </p>
  );
}
