import { env } from '../env.js';

// ponytail: one REST call, so plain fetch instead of the twilio SDK.
export async function sendSms(to: string, body: string): Promise<void> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
  if (!sid || !token || !from) throw new Error('Twilio is not configured');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio responded ${res.status}`);
}
