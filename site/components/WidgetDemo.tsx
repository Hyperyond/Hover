'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * An auto-playing replica of the real Hover widget panel — DOM structure and
 * visual tokens mirror packages/widget-bootstrap/src/widget/{template.html,style.css}
 * so the hero shows the actual product, not a mockup.
 *
 * It loops two scripted sessions to show off both modes:
 *   1. Default mode (mint) — login → add todo → Save as spec.
 *   2. Security mode (orange) — the panel's mode bar flips "engaged", the
 *      agent probes for IDOR / authz, finds one, and offers a Security spec.
 *
 * Pure client-side theatre — no WebSocket, no service. A phase machine on a
 * timer drives the cadence; `mode` swaps the script + the orange/mint theme.
 */

type StepState = 'pending' | 'running' | 'done';
type Mode = 'default' | 'security';

type Scene = {
  mode: Mode;
  prompt: string;
  steps: readonly string[];
  result: {
    headline: string;
    /** When false the result reads as a finding (vulnerability), not a pass. */
    pass: boolean;
    summary: React.ReactNode;
    saveLabel: string;
  };
};

const SCENES: readonly Scene[] = [
  {
    mode: 'default',
    prompt: 'log in, then add a todo named "verify hover"',
    steps: [
      'Opening page',
      'Filling login form',
      'Clicking Sign in',
      'Typing "verify hover"',
      'Verifying todo appears',
    ],
    result: {
      headline: 'PASS — done in 11 steps',
      pass: true,
      summary: (
        <>
          Logged in, added the todo, and confirmed{' '}
          <DemoCode>verify hover</DemoCode> is visible.
        </>
      ),
      saveLabel: 'Save as',
    },
  },
  {
    mode: 'security',
    prompt: 'probe /orders for IDOR — can I read another user’s order?',
    steps: [
      'Capturing API flows',
      'Replaying GET /orders/999',
      'Swapping the resource id',
      'Checking response status',
      'Recording the finding',
    ],
    result: {
      headline: 'FINDING — IDOR confirmed',
      pass: false,
      summary: (
        <>
          <DemoCode>GET /orders/999</DemoCode> returned{' '}
          <span className="text-warn">200</span> — expected{' '}
          <span className="text-mint">403</span>. Another user’s order leaked.
        </>
      ),
      saveLabel: 'Save security spec',
    },
  },
] as const;

export function WidgetDemo() {
  // scene index (which mode's script) + phase within the scene.
  // phase: 0 connecting · 1 user msg · 2..6 steps · 7 result · 8 hold → next scene
  const [sceneIdx, setSceneIdx] = useState(0);
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const scene = SCENES[sceneIdx];

  useEffect(() => {
    const dwell: Record<number, number> = {
      0: 1000,
      1: 1500,
      2: 950,
      3: 950,
      4: 950,
      5: 950,
      6: 1100,
      7: 3400,
      8: 500,
    };
    const t = setTimeout(() => {
      if (phase >= 8) {
        // End of this scene — advance to the next mode's script and restart.
        // Done as two separate setState calls (not a nested updater) so React
        // reliably commits both.
        setSceneIdx((s) => (s + 1) % SCENES.length);
        setPhase(0);
      } else {
        setPhase((p) => p + 1);
      }
    }, dwell[phase] ?? 1000);
    return () => clearTimeout(t);
  }, [phase]);

  // Typewriter for the prompt during phase 1.
  useEffect(() => {
    if (phase !== 1) {
      if (phase === 0) setTyped('');
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(scene.prompt.slice(0, i));
      if (i >= scene.prompt.length) clearInterval(id);
    }, 26);
    return () => clearInterval(id);
  }, [phase, scene.prompt]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [phase, sceneIdx]);

  const engaged = scene.mode === 'security';
  const connected = phase >= 1;
  const showUser = phase >= 1;
  const showResult = phase >= 7;
  const stepStateFor = (idx: number): StepState | null => {
    const revealAt = idx + 2;
    if (phase < revealAt) return null;
    if (phase === revealAt && phase <= 6) return 'running';
    return 'done';
  };

  return (
    <div className="select-none">
      <div
        className={`relative w-[380px] max-w-full overflow-hidden rounded-xl border bg-[var(--color-bg)] shadow-[0_18px_48px_rgba(0,0,0,0.55)] transition-colors duration-500 ${
          engaged ? 'border-[rgba(251,146,60,0.55)]' : 'border-line'
        }`}
      >
        {/* mode bar — only meaningful when a plugin contributes a mode; here it
            is always shown so the demo can flip it. */}
        <ModeBar engaged={engaged} />

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
                connected ? (engaged ? 'bg-[#fb923c]' : 'bg-mint') : 'bg-line-2'
              }`}
              style={connected ? undefined : { animation: 'wd-blink 1s steps(2) infinite' }}
            />
            {connected ? 'ready' : 'connecting…'}
          </span>
        </header>

        {/* body */}
        <div ref={bodyRef} className="wd-body flex h-[336px] flex-col gap-1 overflow-y-auto px-3 py-3">
          {!showUser && (
            <p className="m-auto px-6 text-center font-mono text-[11px] leading-relaxed text-text-dim">
              {engaged
                ? 'Security mode — the agent probes captured API calls.'
                : 'Describe a flow in plain English. Hover drives your real Chrome.'}
            </p>
          )}

          {showUser && (
            <div className="mb-2 flex justify-end">
              <div className="max-w-[86%] rounded-[14px_14px_4px_14px] border border-line bg-bg-2 px-3.5 py-2 text-[13px] leading-snug text-text">
                {phase === 1 ? (
                  <>
                    {typed}
                    <span
                      className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-mint align-middle"
                      style={{ animation: 'wd-blink 0.9s steps(2) infinite' }}
                    />
                  </>
                ) : (
                  scene.prompt
                )}
              </div>
            </div>
          )}

          {phase >= 2 &&
            scene.steps.map((label, i) => {
              const st = stepStateFor(i);
              if (!st) return null;
              return <StepRow key={label} label={label} state={st} engaged={engaged} />;
            })}

          {showResult && <ResultCard scene={scene} />}
        </div>

        {/* composer */}
        <div className="border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-3 px-3 py-2">
            <span className="flex-1 truncate font-mono text-[12px] text-text-dim">
              {phase === 0 || phase >= 7 ? 'Type a flow to test…' : 'Running…'}
            </span>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              className={`flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-bg)] transition-colors ${
                engaged ? 'bg-[#fb923c]' : 'bg-mint'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h9M8 4l4 4-4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes wd-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes wd-spin { to { transform: rotate(360deg) } }
        @keyframes wd-row-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        /* Scrollbar matched to the real widget (style.css): thin, dark thumb,
           transparent track — so a tall scene (security: 5 steps + finding)
           scrolls instead of being squeezed. */
        .wd-body { scrollbar-width: thin; scrollbar-color: #2a2a2c transparent; }
        .wd-body::-webkit-scrollbar { width: 8px; }
        .wd-body::-webkit-scrollbar-track { background: transparent; }
        .wd-body::-webkit-scrollbar-thumb {
          background: #2a2a2c; border-radius: 999px;
          border: 2px solid transparent; background-clip: padding-box;
        }
        .wd-body::-webkit-scrollbar-thumb:hover { background: #3a3a3c; background-clip: padding-box; }
      `}</style>
    </div>
  );
}

function ModeBar({ engaged }: { engaged: boolean }) {
  return (
    <div
      className="flex h-7 w-full items-center gap-2 border-b px-3 text-[11px] font-medium transition-colors duration-500"
      style={
        engaged
          ? {
              background:
                'linear-gradient(180deg, rgba(251,146,60,0.18), rgba(251,146,60,0.08))',
              borderBottomColor: 'rgba(251,146,60,0.55)',
              color: '#fed7aa',
            }
          : {
              background: 'var(--color-bg-2)',
              borderBottomColor: 'var(--color-line)',
              color: 'var(--color-text-mute)',
            }
      }
    >
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full transition-all duration-500"
        style={
          engaged
            ? { background: '#fb923c', boxShadow: '0 0 0 3px rgba(251,146,60,0.18)' }
            : { background: 'var(--color-text-dim)' }
        }
      />
      <span className="font-semibold" style={{ color: engaged ? '#fed7aa' : 'var(--color-text)' }}>
        {engaged ? 'Security testing' : 'Default'}
      </span>
      <span className="text-[9px] opacity-70">▾</span>
      <span className="ml-auto truncate text-[10px] opacity-70">
        {engaged ? 'MITM proxy active' : 'click to switch'}
      </span>
    </div>
  );
}

function StepRow({
  label,
  state,
  engaged,
}: {
  label: string;
  state: StepState;
  engaged: boolean;
}) {
  const running = state === 'running';
  const accent = engaged ? '#fb923c' : 'var(--color-mint)';
  return (
    <div
      className={`relative flex items-center gap-2.5 overflow-hidden rounded-[10px] bg-bg-2 px-3 py-2 text-[12.5px] ${
        running ? 'pl-3.5' : ''
      }`}
      style={{ animation: 'wd-row-in 0.25s ease both' }}
    >
      {running && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      )}
      {running ? (
        <Spinner accent={accent} />
      ) : (
        <span className="flex h-3.5 w-3.5 items-center justify-center" style={{ color: accent }}>
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

function Spinner({ accent }: { accent: string }) {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 rounded-full border-[1.6px] border-line"
      style={{ borderTopColor: accent, animation: 'wd-spin 0.7s linear infinite' }}
    />
  );
}

function ResultCard({ scene }: { scene: Scene }) {
  const { result } = scene;
  const engaged = scene.mode === 'security';
  // pass → mint check; finding → orange alert badge
  const badgeColor = result.pass ? 'var(--color-mint)' : '#fb923c';
  return (
    <div
      className="mt-1 rounded-[10px] border bg-bg-2 p-3"
      style={{
        borderColor: engaged ? 'rgba(251,146,60,0.35)' : 'var(--color-line)',
        animation: 'wd-row-in 0.3s ease both',
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-4 w-4 items-center justify-center rounded-full"
          style={{
            background: result.pass ? 'rgba(124,255,168,0.16)' : 'rgba(251,146,60,0.18)',
            color: badgeColor,
          }}
        >
          {result.pass ? (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8.5l3.2 3.2L13 5" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 5v4M8 11.5v.5" />
            </svg>
          )}
        </span>
        <span className="text-[12.5px] font-semibold" style={{ color: badgeColor }}>
          {result.headline}
        </span>
      </div>
      <p
        className="mb-3 border-l-2 px-2.5 py-0.5 text-[12px] leading-relaxed text-text-mute"
        style={{ borderColor: badgeColor }}
      >
        {result.summary}
      </p>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-semibold"
        style={{
          borderColor: engaged ? 'rgba(251,146,60,0.5)' : 'rgba(124,255,168,0.5)',
          background: engaged ? 'rgba(251,146,60,0.12)' : 'rgba(124,255,168,0.12)',
          color: badgeColor,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M5 3v3h4M5 13v-4h6v4" />
        </svg>
        {result.saveLabel}
        <span className="text-[10px]">▾</span>
      </button>
    </div>
  );
}

function DemoCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-bg-3 px-1 py-0.5 font-mono text-[10.5px] text-text">
      {children}
    </code>
  );
}

function HeaderIcon({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span aria-label={label} className="flex h-7 w-7 items-center justify-center rounded-md text-text-mute">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {children}
      </svg>
    </span>
  );
}
