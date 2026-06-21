'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * An auto-playing replica of the Hover chat panel — visual tokens mirror
 * packages/vscode-ext/src/chatView.ts (linear thread, header, composer toolbar).
 *
 * Loops three scripted sessions:
 *   1. Flow (mint)        — login → add todo → Save as spec
 *   2. QA · API (orange)  — IDOR probe → api-test spec
 *   3. QA · Pentest (red) — XSS pentest → findings report
 * (API + pentest are QA capability toggles in the product; shown here as their
 *  own scenes so each capability reads clearly.)
 */

type Mode = 'default' | 'api-test' | 'pentest';

const ACCENT: Record<Mode, string> = {
  default: '#7CFFA8',
  'api-test': '#fb923c',
  pentest: '#f87171',
};
const ACCENT_INK: Record<Mode, string> = {
  default: '#0c2417',
  'api-test': '#2a1605',
  pentest: '#2a0d0d',
};
const MODE_LABEL: Record<Mode, string> = {
  default: 'Flow',
  'api-test': 'QA · API',
  pentest: 'QA · Pentest',
};
const SESSION_LABEL: Record<Mode, string> = {
  default: 'Todo flow',
  'api-test': 'IDOR probe',
  pentest: 'XSS pentest',
};

type Scene = {
  mode: Mode;
  prompt: string;
  narration: string;
  ops: string[];
  summary: string;
  steps: number;
};

const SCENES: Scene[] = [
  {
    mode: 'default',
    prompt: 'log in, then add a todo named "verify hover"',
    narration: 'Logging in and adding the todo',
    ops: [
      'Navigated to /login',
      'Filled Username → admin@example.com',
      'Filled Password',
      'Clicked "Sign in"',
      'Clicked "Add todo"',
      'Filled input → verify hover',
      'Clicked "Save"',
    ],
    summary: 'Logged in, added the todo, confirmed "verify hover" is visible.',
    steps: 7,
  },
  {
    mode: 'api-test',
    prompt: "probe /orders for IDOR — can I read another user's order?",
    narration: 'Probing the orders endpoint for IDOR',
    ops: [
      'Captured GET /orders/42',
      'Replayed GET /orders/999',
      'Checked status → 200 (expected 403)',
      'Recorded finding',
    ],
    summary: "IDOR confirmed — GET /orders/:id returned another user's order.",
    steps: 5,
  },
  {
    mode: 'pentest',
    prompt: 'pentest the search box for reflected XSS',
    narration: 'Testing the search box for reflected XSS',
    ops: [
      'Navigated to /search',
      'Typed ?q= → <script>alert(1)</script>',
      'Watched response execute',
      'Recorded finding',
    ],
    summary: 'Reflected XSS confirmed in ?q= param. Payload executed unencoded.',
    steps: 4,
  },
];

export function WidgetDemo() {
  const [sceneIdx, setSceneIdx] = useState(0);
  // phase 0=idle, 1=typing user msg, 2=narration appears,
  // 3+i=op[i] visible, RESULT_PHASE=result, HOLD_PHASE=hold
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  const scene = SCENES[sceneIdx];
  const accent = ACCENT[scene.mode];
  const ink = ACCENT_INK[scene.mode];

  // Reduced motion: freeze on a representative completed run instead of looping.
  useEffect(() => {
    if (reduced) { setSceneIdx(0); setPhase(3 + SCENES[0].ops.length); }
  }, [reduced]);

  // Phase timer — phase 1 (typing) is driven by the typewriter effect below
  useEffect(() => {
    if (!run) return;
    if (phase === 1) return;
    const ops = SCENES[sceneIdx].ops;
    const RESULT_PHASE = 3 + ops.length;
    const HOLD_PHASE = RESULT_PHASE + 1;
    const delay =
      phase === 0 ? 900 :
      phase === 2 ? 600 :
      phase >= 3 && phase < RESULT_PHASE ? 750 :
      phase === RESULT_PHASE ? 2800 :
      phase >= HOLD_PHASE ? 600 : 700;
    const id = setTimeout(() => {
      const at = phase + 1;
      if (at > HOLD_PHASE) {
        setSceneIdx((s) => (s + 1) % SCENES.length);
        setPhase(0);
      } else if (phase >= HOLD_PHASE) {
        setSceneIdx((s) => (s + 1) % SCENES.length);
        setPhase(0);
      } else {
        setPhase((p) => p + 1);
      }
    }, delay);
    return () => clearTimeout(id);
  }, [phase, sceneIdx, run]);

  // Typewriter for phase 1 — advances to phase 2 when done
  useEffect(() => {
    if (phase !== 1) {
      if (phase === 0) setTyped('');
      return;
    }
    if (!run) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(scene.prompt.slice(0, i));
      if (i >= scene.prompt.length) {
        clearInterval(id);
        setTimeout(() => setPhase(2), 350);
      }
    }, 22);
    return () => clearInterval(id);
  }, [phase, scene.prompt, run]);

  // Keep log scrolled to bottom as content arrives
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [phase]);

  const ops = scene.ops;
  const RESULT_PHASE = 3 + ops.length;

  const showUser = phase >= 1;
  const showNarration = phase >= 2;
  const visibleOpsCount = Math.min(Math.max(0, phase - 2), ops.length);
  const showResult = phase >= RESULT_PHASE;
  const narrationActive = showNarration && !showResult;

  // Build thread nodes
  type TNode = { kind: 'think' | 'op'; text: string; active: boolean };
  const threadNodes: TNode[] = showNarration
    ? [
        { kind: 'think', text: scene.narration, active: narrationActive },
        ...ops.slice(0, visibleOpsCount).map((op, i) => ({
          kind: 'op' as const,
          text: op,
          active: !showResult && i === visibleOpsCount - 1,
        })),
      ]
    : [];

  return (
    <div ref={rootRef} className="select-none" style={{ width: 400, maxWidth: '100%' }}>
      <div
        className="overflow-hidden rounded-xl shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
        style={{
          background: '#1a1a1a',
          border: `1px solid ${scene.mode === 'default' ? '#2a2a2c' : `${accent}50`}`,
          fontFamily: '-apple-system, system-ui, sans-serif',
          fontSize: 13,
          color: '#e5e7eb',
          transition: 'border-color 0.5s ease',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 10px', borderBottom: '1px solid #2a2a2c',
        }}>
          <span aria-hidden style={{ display: 'inline-flex', padding: 5, color: '#9ca3af' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 9px', border: '1px solid #2a2a2c', borderRadius: 7,
            background: '#222224', color: '#e5e7eb', fontSize: 12, maxWidth: 150,
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {phase === 0 ? 'New session' : SESSION_LABEL[scene.mode]}
            </span>
            <span style={{ color: '#6b7280', fontSize: 10 }}>▾</span>
          </span>
          <span style={{ flex: 1 }} />
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 8px', borderRadius: 7, color: '#9ca3af', fontSize: 12,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: phase >= 1 ? accent : '#6b7280',
              flexShrink: 0, display: 'inline-block',
              transition: 'background 0.3s ease',
            }} />
            localhost
          </span>
        </div>

        {/* Log */}
        <div
          ref={logRef}
          className="wdchat-log"
          style={{
            overflowY: 'auto', padding: '14px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
            height: 400,
          } as React.CSSProperties}
        >
          {/* Empty state placeholder */}
          {!showUser && (
            <div style={{
              margin: 'auto', textAlign: 'center', color: '#6b7280',
              padding: '0 26px', lineHeight: 1.55, fontSize: 12,
            }}>
              {scene.mode === 'pentest'
                ? 'QA · Pentest — attack your own dev app for vulns.'
                : scene.mode === 'api-test'
                ? 'QA · API — probe captured API calls for IDOR & authz.'
                : 'Describe a flow in plain English. Hover drives your real Chrome.'}
            </div>
          )}

          {/* User message bubble */}
          {showUser && (
            <div style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
              <div style={{
                padding: '8px 11px', borderRadius: 10,
                background: accent, color: ink, fontWeight: 500,
                lineHeight: 1.45, fontSize: 13,
              }}>
                {phase === 1 ? (
                  <>{typed}<span style={{ marginLeft: 1, animation: 'wdchat-blink 0.9s steps(2) infinite' }}>▌</span></>
                ) : (
                  scene.prompt
                )}
              </div>
            </div>
          )}

          {/* Linear run thread */}
          {threadNodes.length > 0 && (
            <div style={{ margin: '5px 0 9px' }}>
              {threadNodes.map((node, nodeIdx) => {
                const isFirst = nodeIdx === 0;
                const isLast = nodeIdx === threadNodes.length - 1;
                return (
                  <div key={nodeIdx} style={{ display: 'flex', gap: 9 }}>
                    {/* Rail column */}
                    <div style={{
                      width: 11, flexShrink: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                      {/* Space / connecting line above dot */}
                      {isFirst ? (
                        <div style={{ height: 8, flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 1.5, height: 8, background: '#2a2a2c', flexShrink: 0 }} />
                      )}
                      {/* Dot */}
                      {node.kind === 'think' ? (
                        <div style={{
                          width: 9, height: 9, borderRadius: '50%',
                          background: accent, flexShrink: 0,
                          boxShadow: node.active
                            ? `0 0 0 2px #1a1a1a, 0 0 0 5px ${accent}40`
                            : `0 0 0 2px #1a1a1a, 0 0 0 3.5px ${accent}28`,
                        }} />
                      ) : (
                        <div style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: node.active ? accent : '#1a1a1a',
                          border: `1.5px solid ${node.active ? accent : '#6b7280'}`,
                          boxShadow: '0 0 0 2px #1a1a1a',
                          flexShrink: 0, margin: '0 2px',
                        }} />
                      )}
                      {/* Line below dot → connects to next node */}
                      {!isLast ? (
                        <div style={{ width: 1.5, flex: 1, minHeight: 4, background: '#2a2a2c' }} />
                      ) : (
                        <div style={{ flex: 1 }} />
                      )}
                    </div>
                    {/* Body */}
                    <div style={{
                      flex: 1, minWidth: 0,
                      padding: `${node.kind === 'think' ? 4 : 2}px 8px ${isLast ? 2 : 8}px 0`,
                      wordBreak: 'break-word', overflowWrap: 'anywhere',
                      color: node.kind === 'think'
                        ? (node.active ? accent : '#e5e7eb')
                        : (node.active ? '#e5e7eb' : '#9ca3af'),
                      fontSize: node.kind === 'think' ? 13 : 12,
                      fontFamily: node.kind === 'think'
                        ? '-apple-system, system-ui, sans-serif'
                        : 'ui-monospace, monospace',
                      lineHeight: node.kind === 'think' ? 1.5 : 1.4,
                    } as React.CSSProperties}>
                      {node.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Result block */}
          {showResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px 6px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontWeight: 600, color: '#e5e7eb', fontSize: 13.5,
              }}>
                <span style={{ color: accent, fontWeight: 700 }}>✓</span>
                <span>Done</span>
              </div>
              <div style={{ lineHeight: 1.5, color: '#e5e7eb', fontSize: 13 }}>
                {scene.summary}
              </div>
              <div style={{
                fontSize: 11, color: '#6b7280',
                fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace',
              }}>
                {scene.steps} steps
              </div>
              <button
                type="button" tabIndex={-1} aria-hidden
                style={{
                  alignSelf: 'flex-start', padding: '6px 11px',
                  border: `1px solid ${accent}`, borderRadius: 7,
                  background: 'transparent', color: accent,
                  cursor: 'default', font: 'inherit', fontWeight: 600, fontSize: 12,
                }}
              >
                {scene.mode === 'pentest'
                  ? 'Save findings report'
                  : scene.mode === 'api-test'
                  ? 'Save as api-test spec'
                  : 'Save as spec'}
              </button>
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{
            border: `1px solid ${!showResult && showNarration ? `${accent}80` : '#2a2a2c'}`,
            borderRadius: 12, background: '#141414',
            padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
            transition: 'border-color 0.12s ease',
          }}>
            {/* Placeholder input */}
            <div style={{
              minHeight: 22, color: '#6b7280', fontSize: 13,
              lineHeight: 1.45, padding: '2px 0',
            }}>
              {phase === 0 ? 'e.g. test the login flow  ·  @account to log in' : ''}
            </div>
            {/* Toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              borderTop: '1px solid #2a2a2c',
              margin: '4px -10px 0', padding: '7px 10px 0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 7px', color: '#9ca3af', fontSize: 12, borderRadius: 7,
                }}>
                  <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
                    <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth="3.2"/>
                    <path d="M24 6a18 18 0 0 1 15.6 9H24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/>
                    <path d="M8.4 15a18 18 0 0 0 7.8 26.4l7.8-13.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/>
                    <path d="M39.6 15a18 18 0 0 1-15.6 27l7.8-13.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/>
                  </svg>
                  Headless
                </span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 7px', color: '#9ca3af', fontSize: 12,
                }}>
                  Sonnet 4.6
                </span>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 7px', fontSize: 12, borderRadius: 7,
                  color: scene.mode === 'default' ? '#9ca3af' : accent,
                  transition: 'color 0.3s ease',
                }}>
                  {MODE_LABEL[scene.mode]}
                </span>
                {/* Send — up arrow */}
                <span aria-hidden style={{
                  width: 30, height: 30, borderRadius: 8,
                  background: accent, color: ink,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'background 0.3s ease',
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes wdchat-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        .wdchat-log::-webkit-scrollbar { width: 4px; }
        .wdchat-log::-webkit-scrollbar-track { background: transparent; }
        .wdchat-log::-webkit-scrollbar-thumb { background: #2a2a2c; border-radius: 4px; }
        .wdchat-log { scrollbar-width: thin; scrollbar-color: #2a2a2c transparent; }
      `}</style>
    </div>
  );
}
