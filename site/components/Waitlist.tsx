'use client';

import { useEffect, useState } from 'react';

/**
 * Hover Cloud waitlist — site-styled section + a self-built modal. Click the
 * mint button, a dark modal pops with one email input + submit, which POSTs to
 * /api/waitlist (server route → Resend). No third-party form UI, so the modal
 * matches the dark site exactly.
 *
 * The install path is open (sideload the VS Code extension), so this is NOT a
 * "request a demo" gate — it's a waitlist for the future hosted Cloud product.
 * Copy stays honest: open-source ready *today*, Cloud "coming" with no date.
 */

const CLOUD_FEATURES: [string, string, boolean][] = [
  ['Self-healing re-record', 'when UI drift reds a spec in CI, the agent re-records it from the spec\'s original intent and opens a selector-only PR for you to review', true],
  ['Test-rot detection', 'flags specs whose intent no longer matches your live UI — coverage that exists on paper but verifies the wrong thing', true],
  ['Failure diagnosis', 'each red run gets an AI read of the trace — real bug, or just a moved selector?', true],
  ['Runs, monitoring & dashboards', 'parallel runs, scheduled checks, and trend / flakiness views — layered on later', false],
];

export function Waitlist() {
  const [open, setOpen] = useState(false);

  return (
    <section id="cloud" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
      <div className="relative overflow-hidden rounded-xl border border-line bg-bg-2 px-8 py-12 md:px-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 90% at 20% 0%, rgba(124,255,168,0.10), transparent 70%)',
          }}
        />
        <div className="relative grid items-center gap-10 md:grid-cols-2">
          {/* Left — pitch */}
          <div>
            <div className="mb-4 flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              Hover Cloud
            </div>
            <h2 className="font-mono text-[26px] font-semibold leading-tight tracking-tight md:text-[32px]">
              Free and open-source today.
              <br />
              <span className="text-mint">Cloud is coming.</span>
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-text-mute">
              Everything on this page works right now — add the{' '}
              <span className="text-mint">Hover MCP</span> to your own agent.
              Cloud keeps the specs you author locally alive with AI — it
              re-records the ones UI drift breaks and flags the ones that have
              gone stale:
            </p>
            <ul className="mt-4 max-w-md space-y-2.5 text-[14px] leading-snug text-text-mute">
              {CLOUD_FEATURES.map(([label, sub, ai]) => (
                <li key={label} className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: ai ? 'var(--color-link)' : 'var(--color-mint)' }}
                  />
                  <span>
                    <span className="text-text">{label}</span>
                    {ai ? (
                      <span className="ml-1.5 align-middle font-mono text-[10px] uppercase tracking-wider text-link">
                        AI
                      </span>
                    ) : null}
                    {' — '}
                    {sub}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 max-w-md text-[13px] text-text-dim">
              CI still runs plain Playwright — the AI works on what already ran
              (a broken spec, a flaky one), never on a green build. Authoring
              stays local and free. Leave your email and we&rsquo;ll tell you
              when it&rsquo;s ready; no spam, just the launch.
            </p>
          </div>

          {/* Right — CTA → self-built modal */}
          <div className="flex flex-col items-start justify-center gap-4 lg:items-center lg:text-center">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-md border border-[rgba(124,255,168,0.5)] bg-[rgba(124,255,168,0.12)] px-6 py-3.5 text-[15px] font-semibold text-mint shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-all hover:border-[rgba(124,255,168,0.9)] hover:bg-[rgba(124,255,168,0.18)] hover:shadow-[0_4px_18px_rgba(124,255,168,0.28),0_4px_16px_rgba(0,0,0,0.4)]"
            >
              Join the waitlist →
            </button>
            <p className="text-[12px] text-text-dim">Email only · no spam · just the launch</p>
          </div>
        </div>
      </div>

      {open && <WaitlistModal onClose={() => setOpen(false)} />}
    </section>
  );
}

type Status = 'idle' | 'submitting' | 'done' | 'error';

function WaitlistModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError('');
    try {
      // Trailing slash: the site sets trailingSlash:true, so /api/waitlist
      // 308-redirects to /api/waitlist/. Hit the slashed form directly to
      // avoid the redirect hop on a POST.
      const res = await fetch('/api/waitlist/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setStatus('done');
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || 'Something went wrong. Try again.');
        setStatus('error');
      }
    } catch {
      setError('Network error. Try again.');
      setStatus('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Join the Hover Cloud waitlist"
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      {/* card */}
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-xl border border-line bg-bg p-6 shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
        style={{ animation: 'wl-modal-in 0.2s ease both' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-20"
          style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(124,255,168,0.12), transparent 70%)' }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-text-dim transition-colors hover:bg-bg-2 hover:text-text"
        >
          ✕
        </button>

        {status === 'done' ? (
          <div className="relative py-4 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(124,255,168,0.16)] text-mint">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8.5l3.2 3.2L13 5" />
              </svg>
            </div>
            <p className="text-[15px] font-semibold text-text">You&rsquo;re on the list.</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-mute">
              We&rsquo;ll email you when Hover Cloud opens. Meanwhile it&rsquo;s
              ready right now — add the{' '}
              <span className="text-mint">Hover MCP</span> to your agent.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="relative">
            <h3 className="font-mono text-[17px] font-semibold tracking-tight text-text">
              Join the Cloud waitlist
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-mute">
              One email, that&rsquo;s it. We&rsquo;ll tell you when it&rsquo;s
              ready — no spam.
            </p>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={status === 'submitting'}
              className="mt-4 w-full rounded-lg border border-line bg-bg-3 px-4 py-3 font-mono text-[14px] text-text placeholder:text-text-dim focus:border-mint focus:outline-none disabled:opacity-60"
            />
            {status === 'error' && (
              <p className="mt-2 text-[12.5px] text-error">{error}</p>
            )}
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="mt-3 w-full rounded-lg border border-[rgba(124,255,168,0.5)] bg-mint px-4 py-3 text-[14px] font-semibold text-bg transition-all hover:bg-[#5cf094] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
            </button>
          </form>
        )}
      </div>

      <style>{`
        @keyframes wl-modal-in {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
