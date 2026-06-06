/* ── Pricing ────────────────────────────────────────────────────────────
 * Two columns, honestly: Open Source is the whole product today (free, BYO
 * local CLI, no per-token billing); Cloud is the future hosted layer over the
 * specs (waitlist, no date, no fabricated tiers). We deliberately do NOT show
 * a Pro / Team price grid — Cloud hasn't shipped, so any number would be made
 * up. The "Join the waitlist" CTA scrolls to the existing #cloud section that
 * owns the email-capture modal. */

const OSS_INCLUDES = [
  'The full widget — explore any flow in plain English',
  'Save as Playwright spec or Jira case',
  'Five bundlers + React Native Web',
  'Optional @hover-dev/security mode',
  'BYO local CLI — claude / codex / cursor-agent / aider',
  'Self-hosted, Apache-2.0, no telemetry',
];

const CLOUD_INCLUDES = [
  'Self-healing re-record — a selector-only PR when a spec drifts',
  'Test-rot detection — which specs no longer match your UI',
  'AI failure diagnosis on every red run',
  'Runs, monitoring & dashboards — layered on later',
];

export function Pricing() {
  return (
    <section id="pricing" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Pricing</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        The tool is <span className="text-mint">free, forever</span>. You only
        pay the AI plan you already have.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Hover bundles no AI runtime and resells no tokens. It rides on the
        Claude Pro / Max or ChatGPT plan already on your machine — so authoring
        costs nothing beyond what you pay today, and CI never pays at all.
      </p>

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        {/* Open Source — the live, recommended plan */}
        <article className="relative flex flex-col overflow-hidden rounded-xl border border-[rgba(124,255,168,0.4)] bg-bg-2 p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(70% 60% at 0% 0%, rgba(124,255,168,0.10), transparent 70%)',
            }}
          />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[17px] font-semibold tracking-tight text-text">Open Source</h3>
              <span className="rounded-full border border-[rgba(124,255,168,0.4)] bg-[rgba(124,255,168,0.1)] px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-mint">
                Available now
              </span>
            </div>
            <div className="mt-5 flex items-end gap-2">
              <span className="font-mono text-[44px] font-semibold leading-none text-text">$0</span>
              <span className="mb-1.5 text-[13px] text-text-dim">/ forever · self-hosted</span>
            </div>
            <ul className="mt-7 space-y-3 text-[14px] leading-snug text-text-mute">
              {OSS_INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <a
              href="#install"
              className="mt-8 block rounded-md border border-[rgba(124,255,168,0.5)] bg-mint px-5 py-3 text-center text-[14px] font-semibold text-bg transition-all hover:bg-[#5cf094]"
            >
              Get started in one command →
            </a>
          </div>
        </article>

        {/* Cloud — future, waitlist */}
        <article className="flex flex-col rounded-xl border border-line bg-bg-2 p-8">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[17px] font-semibold tracking-tight text-text">Hover Cloud</h3>
            <span className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              Coming soon
            </span>
          </div>
          <div className="mt-5 flex items-end gap-2">
            <span className="font-mono text-[28px] font-semibold leading-none text-text-mute">
              Pricing at launch
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-text-dim">
            A hosted layer that keeps the specs you author locally alive —
            re-recording the ones UI drift breaks, flagging the ones gone stale.
            Authoring stays free and local; CI still runs plain Playwright.
          </p>
          <ul className="mt-6 space-y-3 text-[14px] leading-snug text-text-mute">
            {CLOUD_INCLUDES.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <Dot />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <a
            href="#cloud"
            className="mt-8 block rounded-md border border-line px-5 py-3 text-center text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
          >
            Join the waitlist →
          </a>
        </article>
      </div>
    </section>
  );
}

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--color-mint)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
      aria-hidden
    >
      <path d="M3 8.5l3.2 3.2L13 5" />
    </svg>
  );
}

function Dot() {
  return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-2" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
      <span className="h-1.5 w-1.5 rounded-full bg-mint" />
      {children}
    </div>
  );
}
