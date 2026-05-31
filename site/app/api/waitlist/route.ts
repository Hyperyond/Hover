import { NextResponse } from 'next/server';
import { Resend } from 'resend';

/**
 * Hover Cloud waitlist intake. The client modal POSTs { email }; we email a
 * notification to the maintainer via Resend. The API key lives only here
 * (server-side) — never shipped to the client.
 *
 * Env (set in Vercel project settings):
 *   RESEND_API_KEY   — Resend API key
 *   WAITLIST_TO      — where to send signups (defaults to claude@sparkplay.io)
 *   WAITLIST_FROM    — verified Resend sender (defaults to a resend.dev sender)
 *
 * Needs the Node.js runtime (Resend SDK), not Edge.
 */
export const runtime = 'nodejs';

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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Misconfiguration — log server-side, return a generic error to the client.
    console.error('[waitlist] RESEND_API_KEY is not set');
    return NextResponse.json({ error: 'Waitlist is temporarily unavailable.' }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  const to = process.env.WAITLIST_TO ?? 'claude@sparkplay.io';
  const from = process.env.WAITLIST_FROM ?? 'Hover Waitlist <onboarding@resend.dev>';

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: `Hover Cloud waitlist — ${clean}`,
      text: `New Hover Cloud waitlist signup:\n\n${clean}\n`,
      replyTo: clean,
    });
    if (error) {
      console.error('[waitlist] resend error', error);
      return NextResponse.json({ error: 'Could not record your signup.' }, { status: 502 });
    }
  } catch (err) {
    console.error('[waitlist] send threw', err);
    return NextResponse.json({ error: 'Could not record your signup.' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
