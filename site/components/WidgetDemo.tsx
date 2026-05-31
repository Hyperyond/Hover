'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * An auto-playing replica of the real Hover widget panel — DOM structure and
 * visual tokens mirror packages/widget-bootstrap/src/widget/{template.html,style.css}
 * so the hero shows the actual product, not a mockup. It loops a scripted
 * session: connect → user types → agent steps run one by one → Result card
 * with a Save-as menu → reset.
 *
 * Pure client-side theatre — no WebSocket, no service. The cadence is driven
 * by a phase machine on a timer.
 */

type StepState = 'pending' | 'running' | 'done';
const STEPS = [
  'Opening page',
  'Filling login form',
  'Clicking Sign in',
  'Typing "verify hover"',
  'Verifying todo appears',
] as const;

const PROMPT = 'log in, then add a todo named "verify hover"';

export function WidgetDemo() {
  // phase: 0 connecting · 1 user msg in · 2..6 steps running · 7 result · 8 hold
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  // Drive the phase machine. Each phase has its own dwell time; after the
  // final hold we loop back to the start so the hero is always "alive".
  useEffect(() => {
    const dwell: Record<number, number> = {
      0: 1100, // connecting
      1: 1400, // user message shown
      2: 950, // step 1
      3: 950,
      4: 950,
      5: 950,
      6: 1100, // step 5
      7: 3200, // result card holds
      8: 600, // brief blank before reset
    };
    const t = setTimeout(() => {
      setPhase((p) => (p >= 8 ? 0 : p + 1));
    }, dwell[phase] ?? 1000);
    return () => clearTimeout(t);
  }, [phase]);

  // Typewriter for the user prompt while phase 1 is active.
  useEffect(() => {
    if (phase !== 1) {
      if (phase === 0) setTyped('');
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(PROMPT.slice(0, i));
      if (i >= PROMPT.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [phase]);

  // Keep the conversation scrolled to the newest row.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase]);

  const connected = phase >= 1;
  const showUser = phase >= 1;
  const stepStateFor = (idx: number): StepState | null => {
    // steps reveal one per phase starting at phase 2
    const revealAt = idx + 2; // step 0 → phase 2
    if (phase < revealAt) return null;
    if (phase === revealAt && phase <= 6) return 'running';
    return 'done';
  };
  const showResult = phase >= 7;

  return (
    <div className="select-none">
      {/* The panel — fixed dimensions echo the real widget (380px wide). */}
      <div className="relative w-[380px] max-w-full overflow-hidden rounded-xl border border-line bg-[var(--color-bg)] shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
        {/* faint top sheen, same as the widget panel */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-16"
          style={{
            background:
              'linear-gradient(to bottom, rgba(255,255,255,0.02), transparent)',
          }}
        />

        {/* header */}
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="flex items-center gap-1.5 rounded-md border border-line bg-bg-3 px-2.5 py-1.5 font-mono text-[12px] text-text">
            claude <span className="text-text-dim">▾</span>
          </span>
          <HeaderIcon label="Saved skills">
            <path d="M2 4h6a1 1 0 0 1 1 1v7H3a1 1 0 0 1-1-1V4Z" />
            <path d="M9 5a1 1 0 0 1 1-1h4v8H10a1 1 0 0 0-1 1V5Z" />
          </HeaderIcon>
          <HeaderIcon label="Star on GitHub">
            <path d="M8 2.2l1.85 3.75 4.15.6-3 2.92.71 4.13L8 11.65l-3.71 1.95.71-4.13-3-2.92 4.15-.6L8 2.2Z" />
          </HeaderIcon>
          <span className="flex-1" />
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] ${
              connected ? 'text-text-mute' : 'text-text-dim'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? 'bg-mint' : 'bg-line-2'
              }`}
              style={
                connected
                  ? undefined
                  : { animation: 'wd-blink 1s steps(2) infinite' }
              }
            />
            {connected ? 'ready' : 'connecting…'}
          </span>
        </header>

        {/* body */}
        <div
          ref={bodyRef}
          className="flex h-[340px] flex-col gap-1 overflow-hidden px-3 py-3"
        >
          {!showUser && (
            <p className="m-auto px-6 text-center font-mono text-[11px] leading-relaxed text-text-dim">
              Describe a flow in plain English.
              <br />
              Hover drives your real Chrome.
            </p>
          )}

          {showUser && (
            <div className="mb-2 flex justify-end">
              <div className="max-w-[86%] rounded-[14px_14px_4px_14px] border border-line bg-bg-2 px-3.5 py-2 text-[13px] leading-snug text-text">
                {phase === 1 ? (
                  <>
                    {typed}
                    <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-mint align-middle" style={{ animation: 'wd-blink 0.9s steps(2) infinite' }} />
                  </>
                ) : (
                  PROMPT
                )}
              </div>
            </div>
          )}

          {/* step rows */}
          {phase >= 2 &&
            STEPS.map((label, i) => {
              const st = stepStateFor(i);
              if (!st) return null;
              return <StepRow key={label} label={label} state={st} />;
            })}

          {/* result card */}
          {showResult && <ResultCard />}
        </div>

        {/* composer */}
        <div className="border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-3 px-3 py-2">
            <span className="flex-1 truncate font-mono text-[12px] text-text-dim">
              {phase === 0 || phase >= 7
                ? 'Type a flow to test…'
                : 'Running…'}
            </span>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-md bg-mint text-[var(--color-bg)] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h9M8 4l4 4-4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* local keyframes for the demo */}
      <style>{`
        @keyframes wd-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes wd-spin { to { transform: rotate(360deg) } }
        @keyframes wd-row-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  const running = state === 'running';
  return (
    <div
      className={`relative flex items-center gap-2.5 overflow-hidden rounded-[10px] px-3 py-2 text-[12.5px] ${
        running ? 'bg-bg-2 pl-3.5' : 'bg-bg-2'
      }`}
      style={{ animation: 'wd-row-in 0.25s ease both' }}
    >
      {running && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-mint"
        />
      )}
      {running ? (
        <Spinner />
      ) : (
        <span className="flex h-3.5 w-3.5 items-center justify-center text-mint">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3.2 3.2L13 5" />
          </svg>
        </span>
      )}
      <span className={running ? 'text-text' : 'text-text-mute'}>{label}</span>
      <span className="flex-1" />
      <span className="text-text-dim">▾</span>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 rounded-full border-[1.6px] border-line border-t-mint"
      style={{ animation: 'wd-spin 0.7s linear infinite' }}
    />
  );
}

function ResultCard() {
  return (
    <div
      className="mt-1 rounded-[10px] border border-line bg-bg-2 p-3"
      style={{ animation: 'wd-row-in 0.3s ease both' }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[rgba(124,255,168,0.16)] text-mint">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3.2 3.2L13 5" />
          </svg>
        </span>
        <span className="text-[12.5px] font-semibold text-text">
          PASS — done in 11 steps
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-text-dim">$0.16</span>
      </div>
      <p className="mb-3 border-l-2 border-mint px-2.5 py-0.5 text-[12px] leading-relaxed text-text-mute">
        Logged in, added the todo, and confirmed{' '}
        <code className="rounded bg-bg-3 px-1 py-0.5 font-mono text-[10.5px] text-mint">
          verify hover
        </code>{' '}
        is visible.
      </p>
      {/* Save-as trigger — mint hover, exactly like the real done card */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="flex items-center gap-1.5 rounded-md border border-[rgba(124,255,168,0.5)] bg-[rgba(124,255,168,0.12)] px-3 py-1.5 text-[12px] font-semibold text-mint"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M5 3v3h4M5 13v-4h6v4" />
        </svg>
        Save as
        <span className="text-[10px]">▾</span>
      </button>
    </div>
  );
}

function HeaderIcon({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-text-mute"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {children}
      </svg>
    </span>
  );
}
