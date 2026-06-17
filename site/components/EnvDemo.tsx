'use client';
import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * Two synced animations for the multi-environment story:
 *  · left  — the chat, where you @-mention a test account
 *  · right — the spec Hover writes, where the credential and BASE_URL are
 *            process.env references that resolve per environment in CI
 *
 * One ticking index drives both, so picking @member on the left swaps the
 * HOVER_MEMBER_* tokens on the right while the environment tab cycles BASE_URL.
 */

const ACCENT = '#7CFFA8';
const BG = '#1a1a1a';
const BG2 = '#222224';
const BG3 = '#141414';
const LINE = '#2a2a2c';
const TEXT = '#e5e7eb';
const TEXT_MUTE = '#9ca3af';
const TEXT_DIM = '#6b7280';
const BLUE = '#7cc4ff';
const STR = '#c8e6a0';

type Row = { account: string; role: string; env: string; baseUrl: string };

const ROWS: Row[] = [
  { account: 'admin', role: 'ADMIN', env: 'Local', baseUrl: 'http://localhost:5173' },
  { account: 'member', role: 'MEMBER', env: 'Staging', baseUrl: 'https://staging.acme.dev' },
  { account: 'viewer', role: 'VIEWER', env: 'Production', baseUrl: 'https://app.acme.com' },
];

const ACCOUNTS = [
  { tag: '@admin', desc: 'full catalog access' },
  { tag: '@member', desc: 'standard shopper' },
  { tag: '@viewer', desc: 'read-only' },
];

const ENVS = ['Local', 'Staging', 'Production'];

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** Token that flashes accent when its value changes (remounts on key). */
function Tok({ children, k }: { children: React.ReactNode; k: number }) {
  return (
    <span key={k} className="env-tok" style={{ color: ACCENT, fontWeight: 600 }}>
      {children}
    </span>
  );
}

export function EnvDemo() {
  const [idx, setIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  useEffect(() => {
    if (!run) return;
    const id = setTimeout(() => setIdx((i) => (i + 1) % ROWS.length), 2300);
    return () => clearTimeout(id);
  }, [idx, run]);

  const row = ROWS[idx];

  const panel: React.CSSProperties = {
    borderRadius: 14,
    border: `1px solid ${LINE}`,
    background: BG,
    overflow: 'hidden',
    fontFamily: '-apple-system, system-ui, sans-serif',
    boxShadow: '0 18px 48px rgba(0,0,0,0.40)',
  };
  const head: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 12px', borderBottom: `1px solid ${LINE}`,
    fontSize: 12, color: TEXT_MUTE,
  };

  return (
    <div
      ref={rootRef}
      className="select-none grid gap-5 lg:grid-cols-2"
      style={{ fontSize: 13, color: TEXT }}
    >
      {/* ── Left: the chat, @-mentioning an account ── */}
      <div style={panel}>
        <div style={head}>
          <span style={{ color: TEXT_DIM, fontFamily: mono }}>chat</span>
          <span style={{ flex: 1 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT }} />
          {row.env.toLowerCase()}
        </div>
        <div style={{
          padding: '14px 14px 16px', minHeight: 250,
          display: 'flex', flexDirection: 'column',
        }}>
          {/* The composer sits at the bottom; the @ autocomplete floats above it,
              anchored to the @ being typed in the input. */}
          <div style={{ marginTop: 'auto', position: 'relative' }}>
            {/* @ autocomplete popover — above the input */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 8px)',
              border: `1px solid ${LINE}`, borderRadius: 10, background: BG2,
              overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }}>
              <div style={{
                padding: '6px 11px', fontSize: 11, color: TEXT_DIM,
                borderBottom: `1px solid ${LINE}`, fontFamily: mono,
              }}>
                accounts
              </div>
              {ACCOUNTS.map((a, i) => {
                const on = i === idx;
                return (
                  <div
                    key={a.tag}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      padding: '7px 11px',
                      background: on ? `${ACCENT}12` : 'transparent',
                      borderLeft: `2px solid ${on ? ACCENT : 'transparent'}`,
                      transition: 'background 0.25s ease, border-color 0.25s ease',
                    }}
                  >
                    <span style={{
                      fontFamily: mono, fontSize: 13, fontWeight: 600,
                      color: on ? ACCENT : TEXT,
                    }}>
                      {a.tag}
                    </span>
                    <small style={{ color: TEXT_DIM, fontSize: 11 }}>{a.desc}</small>
                  </div>
                );
              })}
            </div>

            {/* composer input — the @mention is being typed here */}
            <div style={{
              border: `1px solid ${ACCENT}80`, borderRadius: 12, background: BG3,
              padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: TEXT }}>
                run checkout as{' '}
                <span key={idx} className="env-tok" style={{ color: ACCENT, fontWeight: 600, fontFamily: mono }}>
                  @{row.account}
                </span>
                <span className="env-caret">▌</span>
              </span>
              <span style={{ marginLeft: 'auto' }} />
              <span aria-hidden style={{
                width: 28, height: 28, borderRadius: 8, background: ACCENT, color: '#0c2417',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right: the spec Hover writes, env vars resolved per environment ── */}
      <div style={panel}>
        <div style={head}>
          <span style={{ color: TEXT_DIM, fontFamily: mono }}>checkout.spec.ts</span>
          <span style={{ flex: 1 }} />
          {/* environment tabs */}
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {ENVS.map((e, i) => (
              <span
                key={e}
                style={{
                  padding: '2px 7px', borderRadius: 6, fontSize: 11,
                  fontFamily: mono,
                  color: i === idx ? '#0c2417' : TEXT_DIM,
                  background: i === idx ? ACCENT : 'transparent',
                  border: `1px solid ${i === idx ? ACCENT : LINE}`,
                  transition: 'all 0.25s ease',
                }}
              >
                {e}
              </span>
            ))}
          </span>
        </div>
        <div style={{
          padding: '14px 14px', fontFamily: mono, fontSize: 12.5,
          lineHeight: 1.7, color: TEXT_MUTE, minHeight: 250,
        }}>
          <div style={{ color: TEXT_DIM }}>{`// runs in CI — no agent, no key`}</div>
          <div>
            <span style={{ color: BLUE }}>test</span>(
            <span style={{ color: STR }}>&apos;checkout as <Tok k={idx}>@{row.account}</Tok>&apos;</span>,
            async (&#123; page &#125;) =&gt; &#123;
          </div>
          <div style={{ paddingLeft: 18 }}>
            await page.<span style={{ color: BLUE }}>goto</span>(process.env.<span style={{ color: TEXT }}>BASE_URL</span>!);
          </div>
          <div style={{ paddingLeft: 18 }}>
            await <span style={{ color: BLUE }}>loginAs</span>(page, &#123;
          </div>
          <div style={{ paddingLeft: 36 }}>
            user: process.env.<Tok k={idx}>HOVER_{row.role}_USER</Tok>!,
          </div>
          <div style={{ paddingLeft: 36 }}>
            pass: process.env.<Tok k={idx}>HOVER_{row.role}_PASSWORD</Tok>!,
          </div>
          <div style={{ paddingLeft: 18 }}>&#125;);</div>
          <div>&#125;);</div>

          {/* resolved-from-secrets footer */}
          <div style={{
            marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINE}`,
            fontSize: 11.5, color: TEXT_DIM,
          }}>
            <div style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 10 }}>
              resolved in {row.env}
            </div>
            <div>
              BASE_URL = <Tok k={idx}>{row.baseUrl}</Tok>
            </div>
            <div>
              HOVER_<Tok k={idx}>{row.role}</Tok>_PASSWORD ={' '}
              <span style={{ color: TEXT_DIM }}>••••••••</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes envflash {
          0% { background: ${ACCENT}38; }
          100% { background: transparent; }
        }
        .env-tok {
          border-radius: 3px;
          padding: 0 1px;
          animation: envflash 0.9s ease-out;
        }
        @keyframes envblink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        .env-caret { margin-left: 1px; color: ${TEXT_DIM}; animation: envblink 1s steps(2) infinite; }
      `}</style>
    </div>
  );
}
