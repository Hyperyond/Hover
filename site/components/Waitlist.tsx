'use client';

import { useEffect } from 'react';

/**
 * Hover Cloud waitlist — a site-styled section wrapping a Tally embed.
 *
 * The install path is fully public (npx @hover-dev/cli add), so this is NOT a
 * "request a demo" gate — it's a waitlist for the future hosted Cloud product.
 * Copy must stay honest: open-source is ready *today*, Cloud is "coming" with
 * no promised date (no "beta" / "soon-ish" claims).
 *
 * Tally is loaded via its embed script + a transparent iframe so it inherits
 * the dark page behind it. Replace TALLY_FORM_ID once the form exists at
 * tally.so — the embed URL is https://tally.so/embed/<id>.
 */

// TODO(waitlist): replace with the real Tally form id once created.
// From the form's Share/Embed URL: https://tally.so/embed/<THIS-PART>
const TALLY_FORM_ID = 'TODO_TALLY_FORM_ID';

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void };
  }
}

export function Waitlist() {
  // Load Tally's embed script once, then (re)hydrate any iframes on the page.
  useEffect(() => {
    const SRC = 'https://tally.so/widgets/embed.js';
    const hydrate = () => window.Tally?.loadEmbeds();

    if (window.Tally) {
      hydrate();
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = SRC;
      script.async = true;
      script.onload = hydrate;
      document.body.appendChild(script);
    } else {
      script.addEventListener('load', hydrate);
    }
  }, []);

  const configured = TALLY_FORM_ID !== 'TODO_TALLY_FORM_ID';

  return (
    <section id="cloud" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
      <div className="relative overflow-hidden rounded-xl border border-line bg-bg-2 px-8 py-12 md:px-14">
        {/* faint mint bloom, same language as the CTA card */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 90% at 20% 0%, rgba(124,255,168,0.10), transparent 70%)',
          }}
        />
        <div className="relative grid items-center gap-10 md:grid-cols-2">
          {/* Left — the honest pitch */}
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
              Everything on this page works right now with{' '}
              <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-mint">
                npx @hover-dev/cli add
              </code>
              . Cloud adds hosted parallel runs, a results dashboard, and team
              features. Leave your email and we&rsquo;ll tell you when it&rsquo;s
              ready — no spam, just the launch.
            </p>
          </div>

          {/* Right — the Tally form (or a placeholder until wired) */}
          <div className="min-h-[140px]">
            {configured ? (
              <iframe
                data-tally-src={`https://tally.so/embed/${TALLY_FORM_ID}?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1`}
                loading="lazy"
                width="100%"
                height="180"
                title="Join the Hover Cloud waitlist"
                className="w-full"
              />
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-bg-3 px-5 py-6 text-[13px] leading-relaxed text-text-dim">
                <p className="font-mono text-text-mute">⚙ waitlist form not wired yet</p>
                <p className="mt-2">
                  Create the Tally form, then set{' '}
                  <code className="text-mint">TALLY_FORM_ID</code> in{' '}
                  <code className="text-text-mute">components/Waitlist.tsx</code>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
