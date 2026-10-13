import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { startSession } from '../features/auth/session';
import type { SessionResponse } from '../lib/types';

const RESEND_SEC = 60;
const PHONE_KEY = 'skipli.ownerPhone'; // spec: remember the owner's phone number

function readPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState(readPhone);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [cooldown, setCooldown] = useState(0);
  const [demoCode, setDemoCode] = useState<string>();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = useMutation({
    mutationFn: () =>
      post<{ success: true; accessCode?: string }>('/owner/CreateNewAccessCode', {
        phoneNumber: phone,
      }),
    onSuccess: (res) => {
      try {
        localStorage.setItem(PHONE_KEY, phone);
      } catch {
        // storage unavailable (private mode); not critical
      }
      setStep('code');
      setCooldown(RESEND_SEC);
      setDemoCode(res.accessCode);
      setCode(res.accessCode ?? '');
    },
  });

  const verify = useMutation({
    mutationFn: () =>
      post<SessionResponse>('/owner/ValidateAccessCode', { phoneNumber: phone, accessCode: code }),
    onSuccess: (session) => {
      startSession(session);
      navigate('/', { replace: true });
    },
  });

  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    sendCode.mutate();
  };
  const onCode = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate();
  };

  const error = step === 'phone' ? sendCode.error : (verify.error ?? sendCode.error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>

        {step === 'phone' ? (
          <form onSubmit={onPhone} className="mt-6 space-y-4">
            <p className="text-sm text-slate-500">
              We'll text a 6-digit code to the owner's phone.
            </p>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Phone number</span>
              <input
                type="tel"
                autoComplete="tel"
                required
                placeholder="+1 555 555 0100"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <button
              type="submit"
              disabled={sendCode.isPending}
              className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {sendCode.isPending ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={onCode} className="mt-6 space-y-4">
            <p className="text-sm text-slate-500">
              Enter the code sent to <span className="font-medium text-slate-700">{phone}</span>.{' '}
              <button
                type="button"
                onClick={() => setStep('phone')}
                className="text-blue-600 hover:underline"
              >
                Change
              </button>
            </p>
            {demoCode && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Demo account: your code is{' '}
                <span className="font-mono font-semibold">{demoCode}</span>
              </p>
            )}
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Access code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-[0.5em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <button
              type="submit"
              disabled={verify.isPending || code.length !== 6}
              className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {verify.isPending ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              disabled={cooldown > 0 || sendCode.isPending}
              onClick={() => sendCode.mutate()}
              className="w-full text-sm text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error.message}
          </p>
        )}
      </div>
    </main>
  );
}
