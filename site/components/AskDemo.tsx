'use client';
import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * A replica of Hover's in-chat ask_user flow — shell + tokens + behaviour mirror
 * the current packages/vscode-ext/src/chatView.ts (addAskCard):
 *   · the ask card DOCKS at the bottom in place of the composer (#ask-dock)
 *   · every ask carries an "✎ Other — type your own instruction…" free-text row
 *   · once answered, the card is gone and a single thread node is dropped onto
 *     the run: "You answered: <value>" (an `op answered` node, accent-coloured)
 *
 * Three decisions of different kinds cycle: a multiple-choice account pick, a
 * destructive yes/no, and a free-text "Other" instruction the user types.
 */

const ACCENT = '#7CFFA8';
const INK = '#0c2417';
const BG = '#1a1a1a';
const BG2 = '#222224';
const BG3 = '#141414';
const LINE = '#2a2a2c';
const TEXT = '#e5e7eb';
const TEXT_MUTE = '#9ca3af';
const TEXT_DIM = '#6b7280';

type Opt = { label: string; desc?: string };
type Ask = { kind: 'choice' | 'other'; q: string; options: Opt[]; pick?: number; otherText?: string };

const ASK1: Ask = {
  kind: 'choice',
  q: 'Which account should I use for the checkout flow?',
  options: [
    { label: '@admin', desc: 'full catalog + order history' },
    { label: '@member', desc: 'standard shopper' },
    { label: '@viewer', desc: 'read-only, no cart' },
  ],
  pick: 1,
};
const ASK2: Ask = {
  kind: 'choice',
  q: 'This step deletes every saved card on the account. Run it?',
  options: [
    { label: 'Run it', desc: 'this is a throwaway test account' },
    { label: 'Skip the step', desc: 'leave saved cards in place' },
  ],
  pick: 0,
};
const ASK3: Ask = {
  kind: 'other',
  q: 'I can’t find a “Checkout” button on this page. How should I proceed?',
  options: [
    { label: 'Use the cart link', desc: 'top-right corner' },
    { label: 'Reload and retry' },
  ],
  otherText: 'Open the cart, then click “Proceed to checkout”',
};

type NodeKind = 'think' | 'op' | 'answered';
const NODES: { kind: NodeKind; text: string; at: number }[] = [
  { kind: 'think', text: 'Setting up the checkout flow', at: 2 },
  { kind: 'op', text: 'Opened /checkout', at: 3 },
  { kind: 'answered', text: 'You answered: @member', at: 5 },
  { kind: 'op', text: 'Signed in as @member', at: 5 },
  { kind: 'answered', text: 'You answered: Run it', at: 7 },
  { kind: 'op', text: 'Cleared the saved cards', at: 7 },
  { kind: 'answered', text: 'You answered: Open the cart, then click “Proceed to checkout”', at: 9 },
  { kind: 'op', text: 'Reached checkout and re-added a card', at: 9 },
];

/* Timeline: 0 empty · 1 user · 2 think · 3 op · 4 ASK1 · 5 answer+op · 6 ASK2
 * · 7 answer+op · 8 ASK3 (free-text) · 9 answer+op · 10 result · loop */
const ASK_PHASES = [4, 6, 8];

export function AskDemo() {
  const [phase, setPhase] = useState(0);
  const [pick, setPick] = useState(false);
  const [otherTyped, setOtherTyped] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  // Reduced motion: freeze on the finished run instead of looping.
  useEffect(() => {
    if (reduced) { setPick(true); setPhase(10); }
  }, [reduced]);

  // Phase timer
  useEffect(() => {
    if (!run) return;
    setPick(false);
    if (phase !== 8) setOtherTyped('');
    let pickTimer: ReturnType<typeof setTimeout> | undefined;
    if (phase === 4 || phase === 6) pickTimer = setTimeout(() => setPick(true), 1500);
    if (phase === 8) pickTimer = setTimeout(() => setPick(true), 2500);
    const dur =
      phase === 0 ? 700 :
      phase === 4 || phase === 6 ? 2700 :
      phase === 8 ? 3400 :
      phase === 10 ? 3000 :
      phase === 5 || phase === 7 || phase === 9 ? 950 :
      800;
    const adv = setTimeout(() => setPhase((p) => (p >= 10 ? 0 : p + 1)), dur);
    return () => { clearTimeout(adv); if (pickTimer) clearTimeout(pickTimer); };
  }, [phase, run]);

  // Free-text typewriter for ASK3
  useEffect(() => {
    if (!run || phase !== 8) return;
    const text = ASK3.otherText ?? '';
    let i = 0;
    const id = setInterval(() => {
      i++;
      setOtherTyped(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 34);
    return () => clearInterval(id);
  }, [phase, run]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [phase, otherTyped]);

  const asking: Ask | null = phase === 4 ? ASK1 : phase === 6 ? ASK2 : phase === 8 ? ASK3 : null;
  const visible = NODES.filter((n) => phase >= n.at);
  const lastIdx = visible.length - 1;
  const liveIdx = !asking && phase >= 2 && phase < 10 && visible[lastIdx]?.kind !== 'answered' ? lastIdx : -1;

  return (
    <div ref={rootRef} className="select-none" style={{ width: 440, maxWidth: '100%', margin: '0 auto' }}>
      <div style={{
        borderRadius: 14, border: `1px solid ${LINE}`, background: BG, overflow: 'hidden',
        fontFamily: '-apple-system, system-ui, sans-serif', fontSize: 13, color: TEXT,
        boxShadow: '0 18px 48px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', height: 540,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${LINE}` }}>
          <span aria-hidden style={{ display: 'inline-flex', padding: 5, color: TEXT_MUTE }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px',
            border: `1px solid ${LINE}`, borderRadius: 7, background: BG2, color: TEXT, fontSize: 12,
          }}>
            {phase >= 1 ? 'Checkout flow' : 'New session'}
            <span style={{ color: TEXT_DIM, fontSize: 10 }}>▾</span>
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', color: TEXT_MUTE, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: phase >= 1 ? ACCENT : TEXT_DIM, display: 'inline-block' }} />
            localhost
          </span>
        </div>

        {/* Log */}
        <div ref={logRef} className="askdemo-log" style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {phase === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', color: TEXT_DIM, padding: '0 26px', lineHeight: 1.55, fontSize: 12 }}>
              It asks before it guesses. You answer in the chat.
            </div>
          )}

          {phase >= 1 && (
            <div style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
              <div style={{ padding: '8px 11px', borderRadius: 10, background: ACCENT, color: INK, fontWeight: 500, lineHeight: 1.45, fontSize: 13 }}>
                test checkout, then clear and re-add saved cards
              </div>
            </div>
          )}

          {/* Linear run thread — think / op / answered nodes on one rail */}
          {visible.length > 0 && (
            <div style={{ margin: '2px 0 2px' }}>
              {visible.map((n, i) => {
                const first = i === 0;
                const last = i === visible.length - 1;
                const live = i === liveIdx;
                const isThink = n.kind === 'think';
                const isAnswered = n.kind === 'answered';
                return (
                  <div key={i} style={{ display: 'flex', gap: 9 }}>
                    <div style={{ width: 11, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {first ? <div style={{ height: 8 }} /> : <div style={{ width: 1.5, height: 8, background: LINE }} />}
                      {isThink ? (
                        <div style={{
                          width: 9, height: 9, borderRadius: '50%', background: ACCENT, flexShrink: 0,
                          boxShadow: live ? `0 0 0 2px ${BG}, 0 0 0 5px ${ACCENT}40` : `0 0 0 2px ${BG}, 0 0 0 3.5px ${ACCENT}28`,
                        }} />
                      ) : (
                        <div style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: (live || isAnswered) ? ACCENT : BG,
                          border: `1.5px solid ${(live || isAnswered) ? ACCENT : TEXT_DIM}`,
                          boxShadow: `0 0 0 2px ${BG}`, flexShrink: 0, margin: '0 2px',
                        }} />
                      )}
                      {!last ? <div style={{ width: 1.5, flex: 1, minHeight: 4, background: LINE }} /> : <div style={{ flex: 1 }} />}
                    </div>
                    <div style={{
                      flex: 1, minWidth: 0,
                      padding: `${isThink ? 4 : 2}px 8px ${last ? 2 : 8}px 0`,
                      wordBreak: 'break-word',
                      color: isAnswered ? ACCENT : isThink ? TEXT : (live ? TEXT : TEXT_MUTE),
                      fontSize: isThink ? 13 : 12,
                      fontFamily: isThink ? '-apple-system, system-ui, sans-serif' : 'ui-monospace, monospace',
                      lineHeight: isThink ? 1.5 : 1.4,
                    }}>{n.text}</div>
                  </div>
                );
              })}
            </div>
          )}

          {phase >= 10 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px 6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: TEXT, fontSize: 13.5 }}>
                <span style={{ color: ACCENT, fontWeight: 700 }}>✓</span>Done
              </div>
              <div style={{ lineHeight: 1.5, color: TEXT, fontSize: 13 }}>
                Checkout verified as @member. Cleared the saved cards and re-added one.
              </div>
            </div>
          )}
        </div>

        {/* Bottom dock — the ask card replaces the composer while a question is open */}
        <div style={{ padding: '10px 12px 12px' }}>
          {asking ? (
            <div style={{
              border: `1px solid ${LINE}`, borderLeft: `3px solid ${ACCENT}`, borderRadius: 12,
              background: BG3, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10,
              boxShadow: '0 -2px 18px rgba(0,0,0,0.35)', animation: 'askpop 0.18s ease-out',
            }}>
              <div style={{ fontWeight: 600, color: TEXT, fontSize: 13, lineHeight: 1.4 }}>{asking.q}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {asking.options.map((o, oi) => {
                  const chosen = asking.kind === 'choice' && pick && oi === asking.pick;
                  return (
                    <div key={o.label} style={{
                      textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2,
                      padding: '8px 11px', borderRadius: 8,
                      border: `1px solid ${chosen ? ACCENT : LINE}`,
                      background: chosen ? `${ACCENT}12` : BG,
                      transition: 'border-color 0.2s ease, background 0.2s ease',
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: chosen ? ACCENT : TEXT, fontFamily: 'ui-monospace, monospace' }}>{o.label}</span>
                      {o.desc && <small style={{ color: TEXT_DIM, fontSize: 11 }}>{o.desc}</small>}
                    </div>
                  );
                })}

                {asking.kind === 'choice' ? (
                  // Always-present "Other" free-text row (collapsed)
                  <div style={{ padding: '8px 11px', borderRadius: 8, border: `1px solid ${LINE}`, background: BG, color: TEXT_DIM, fontSize: 12.5 }}>
                    ✎ Other — type your own instruction…
                  </div>
                ) : (
                  // Free-text path expanded: the user typed a custom instruction
                  <>
                    <div style={{ padding: '8px 11px', borderRadius: 8, border: `1px solid ${ACCENT}`, background: `${ACCENT}12`, color: ACCENT, fontSize: 12.5 }}>
                      ✎ Other — type your own instruction…
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <div style={{
                        flex: 1, padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 7,
                        background: BG, color: TEXT, fontSize: 12.5, minHeight: 18,
                      }}>
                        {otherTyped}
                        <span className="askdemo-caret">▌</span>
                      </div>
                      <span aria-hidden style={{
                        padding: '7px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                        border: `1px solid ${ACCENT}`,
                        background: pick ? ACCENT : 'transparent', color: pick ? INK : ACCENT,
                        transition: 'background 0.2s ease, color 0.2s ease',
                      }}>
                        Send
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: BG3, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ minHeight: 22, color: TEXT_DIM, fontSize: 13, lineHeight: 1.45, padding: '2px 0' }}>
                {phase === 0 ? 'e.g. test the checkout flow  ·  @account to log in' : ''}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${LINE}`, margin: '4px -10px 0', padding: '7px 10px 0' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 7px', color: TEXT_MUTE, fontSize: 12 }}>
                  <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
                    <circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" strokeWidth="3.2" />
                    <path d="M24 6a18 18 0 0 1 15.6 9H24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                    <path d="M8.4 15a18 18 0 0 0 7.8 26.4l7.8-13.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                    <path d="M39.6 15a18 18 0 0 1-15.6 27l7.8-13.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                  </svg>
                  Headless
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 7px', color: TEXT_MUTE, fontSize: 12 }}>Sonnet 4.6</span>
                <span style={{ marginLeft: 'auto' }} />
                <span aria-hidden style={{
                  width: 30, height: 30, borderRadius: 8, background: ACCENT, color: INK,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M6 11l6-6 6 6" />
                  </svg>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes askpop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes askblink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        .askdemo-caret { margin-left: 1px; color: ${TEXT_DIM}; animation: askblink 1s steps(2) infinite; }
        .askdemo-log::-webkit-scrollbar { width: 4px; }
        .askdemo-log::-webkit-scrollbar-track { background: transparent; }
        .askdemo-log::-webkit-scrollbar-thumb { background: #2a2a2c; border-radius: 4px; }
        .askdemo-log { scrollbar-width: thin; scrollbar-color: #2a2a2c transparent; }
      `}</style>
    </div>
  );
}
