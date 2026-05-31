import { NextResponse } from 'next/server';
import { SendMailClient } from 'zeptomail';

/**
 * Hover Cloud waitlist intake. The client modal POSTs { email }; we notify the
 * maintainer via Zoho ZeptoMail's official SDK. The send token lives only here
 * (server-side) — never shipped to the client, never hard-coded.
 *
 * Env (set in Vercel project settings):
 *   ZEPTOMAIL_TOKEN — the full "Send Mail token" INCLUDING the "Zoho-enczapikey "
 *                     prefix, exactly as shown in the ZeptoMail console.
 *   WAITLIST_TO     — where signups go (defaults to oliver@hyperyond.com).
 *   WAITLIST_FROM   — sender on the ZeptoMail-verified domain
 *                     (defaults to noreply@gethover.dev).
 *
 * Needs the Node.js runtime (SDK + token must stay server-side).
 */
export const runtime = 'nodejs';

const ZEPTO_URL = 'https://api.zeptomail.com/';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 422 });
  }
  const clean = email.trim().toLowerCase();

  const token = process.env.ZEPTOMAIL_TOKEN;
  if (!token) {
    console.error('[waitlist] ZEPTOMAIL_TOKEN is not set');
    return NextResponse.json({ error: 'Waitlist is temporarily unavailable.' }, { status: 503 });
  }
  const from = process.env.WAITLIST_FROM ?? 'noreply@gethover.dev';
  const to = process.env.WAITLIST_TO ?? 'oliver@hyperyond.com';

  try {
    const client = new SendMailClient({ url: ZEPTO_URL, token });
    await client.sendMail({
      from: { address: from, name: 'Hover Waitlist' },
      to: [{ email_address: { address: to, name: 'Hover' } }],
      subject: `Hover Cloud waitlist — ${clean}`,
      htmlbody: `<div>New Hover Cloud waitlist signup:<br/><br/><b>${clean}</b></div>`,
    });
  } catch (err) {
    console.error('[waitlist] zeptomail send failed', err);
    return NextResponse.json({ error: 'Could not record your signup.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
