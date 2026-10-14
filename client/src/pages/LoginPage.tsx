import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard } from '../components/AuthCard';
import { button } from '../components/ui';
import { CodeLogin } from '../features/auth/CodeLogin';
import { PasswordLogin } from '../features/auth/PasswordLogin';
import { startSession } from '../features/auth/session';
import type { SessionResponse } from '../lib/types';

type Tab = 'owner' | 'employee';
const TAB_KEY = 'skipli.loginTab';
const PHONE_KEY = 'skipli.ownerPhone'; // spec: remember the owner's phone number

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'employee' ? 'employee' : 'owner';
  } catch {
    return 'owner';
  }
}

// Set by the setup page after an employee creates their account.
type FromSetup = { username?: string } | null;

export default function LoginPage() {
  const navigate = useNavigate();
  const fromSetup = useLocation().state as FromSetup;
  const [tab, setTab] = useState<Tab>(fromSetup?.username ? 'employee' : readTab);
  const [employeeMethod, setEmployeeMethod] = useState<'password' | 'code'>('password');

  const pickTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // not critical
    }
  };

  const onSignedIn = (session: SessionResponse) => {
    startSession(session);
    navigate('/', { replace: true });
  };

  return (
    <AuthCard title="Sign in">
      {fromSetup?.username && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Your account is ready. Sign in with your new password.
        </p>
      )}

      <div
        role="tablist"
        aria-label="Account type"
        className="mt-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-medium"
      >
        {(['owner', 'employee'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => pickTab(t)}
            className={`rounded-md py-1.5 ${tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'owner' ? 'Owner' : 'Employee'}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="mt-6">
        {tab === 'owner' ? (
          <CodeLogin
            key="owner"
            field="phoneNumber"
            label="Phone number"
            type="tel"
            placeholder="+1 555 555 0100"
            hint="We'll text a 6-digit code to the owner's phone."
            sendPath="/owner/CreateNewAccessCode"
            verifyPath="/owner/ValidateAccessCode"
            storageKey={PHONE_KEY}
            onSignedIn={onSignedIn}
          />
        ) : employeeMethod === 'password' ? (
          <>
            <PasswordLogin initialUsername={fromSetup?.username} onSignedIn={onSignedIn} />
            <button
              onClick={() => setEmployeeMethod('code')}
              className={`${button.link} mt-4 w-full`}
            >
              Email me a sign-in code instead
            </button>
          </>
        ) : (
          <>
            <CodeLogin
              key="employee"
              field="email"
              label="Work email"
              type="email"
              placeholder="you@company.com"
              hint="We'll email you a 6-digit code."
              sendPath="/employee/LoginEmail"
              verifyPath="/employee/ValidateAccessCode"
              onSignedIn={onSignedIn}
            />
            <button
              onClick={() => setEmployeeMethod('password')}
              className={`${button.link} mt-4 w-full`}
            >
              Use username and password instead
            </button>
          </>
        )}
      </div>
    </AuthCard>
  );
}
