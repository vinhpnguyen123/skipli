import { env } from '../env.js';

type Email = { to: string; subject: string; text: string; html: string };

// ponytail: one REST call, so plain fetch instead of the resend SDK.
export async function sendEmail({ to, subject, text, html }: Email): Promise<void> {
  const { RESEND_API_KEY: key, EMAIL_FROM: from } = env;
  if (!key || !from) throw new Error('Resend is not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!res.ok) {
    // Resend explains rejections (unverified domain, test-sender limits); keep that in the log.
    const detail = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    throw new Error(`Resend responded ${res.status}${detail ? `: ${detail}` : ''}`);
  }
}

// For user-supplied values (names) placed in email HTML.
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
