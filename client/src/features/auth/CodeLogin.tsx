import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '../../components/AuthCard';
import { button, input } from '../../components/ui';
import { post } from '../../lib/api';
import type { SessionResponse } from '../../lib/types';

const RESEND_SEC = 60;

type Props = {
  // Owner: phone → /owner/*, employee: email → /employee/*. `field` is the request body key.
  field: 'phoneNumber' | 'email';
  label: string;
  type: 'tel' | 'email';
  placeholder: string;
  hint: string;
  sendPath: string;
  verifyPath: string;
  storageKey?: string; // remember the last value typed
  onSignedIn: (session: SessionResponse) => void;
};

function read(key?: string) {
  if (!key) return '';
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

// Two steps: send a 6-digit code, then verify it. Shared by owner (SMS) and employee (email) sign-in.
export function CodeLogin({
  field,
  label,
  type,
  placeholder,
  hint,
  sendPath,
  verifyPath,
  storageKey,
  onSignedIn,
}: Props) {
  const [target, setTarget] = useState(() => read(storageKey));
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'target' | 'code'>('target');
  const [cooldown, setCooldown] = useState(0);
  const [demoCode, setDemoCode] = useState<string>();

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = useMutation({
    mutationFn: () => post<{ success: true; accessCode?: string }>(sendPath, { [field]: target }),
    onSuccess: (res) => {
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, target);
        } catch {
          // storage unavailable (private mode); not critical
        }
      }
      setStep('code');
      setCooldown(RESEND_SEC);
      setDemoCode(res.accessCode);
      setCode(res.accessCode ?? '');
    },
  });

  const verify = useMutation({
    mutationFn: () => post<SessionResponse>(verifyPath, { [field]: target, accessCode: code }),
    onSuccess: onSignedIn,
  });

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    sendCode.mutate();
  };
  const onVerify = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate();
  };

  if (step === 'target') {
    return (
      <form onSubmit={onSend} className="space-y-4">
        <p className="text-sm text-slate-500">{hint}</p>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          <input
            type={type}
            autoComplete={type === 'tel' ? 'tel' : 'email'}
            required
            placeholder={placeholder}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={input}
          />
        </label>
        <button type="submit" disabled={sendCode.isPending} className={`${button.primary} w-full`}>
          {sendCode.isPending ? 'Sending…' : 'Send code'}
        </button>
        <FormError error={sendCode.error} />
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} className="space-y-4">
      <p className="text-sm text-slate-500">
        Enter the code sent to <span className="font-medium text-slate-700">{target}</span>.{' '}
        <button type="button" onClick={() => setStep('target')} className={button.link}>
          Change
        </button>
      </p>
      {demoCode && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Demo account: your code is <span className="font-mono font-semibold">{demoCode}</span>
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
          className={`${input} text-center font-mono text-lg tracking-[0.5em]`}
        />
      </label>
      <button
        type="submit"
        disabled={verify.isPending || code.length !== 6}
        className={`${button.primary} w-full`}
      >
        {verify.isPending ? 'Verifying…' : 'Verify'}
      </button>
      <button
        type="button"
        disabled={cooldown > 0 || sendCode.isPending}
        onClick={() => sendCode.mutate()}
        className={`${button.link} w-full`}
      >
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </button>
      <FormError error={verify.error ?? sendCode.error} />
    </form>
  );
}
