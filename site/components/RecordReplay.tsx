'use client';

import { useEffect, useRef } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * record == replay, drawn directly.
 *
 * Top: the user's debug Chrome on the Acme Store login (shop.acme.dev/login).
 * The agent clicks the "Log in" button by role+name — a grounded action (a
 * click ripple fires). A connector carries that exact target down into the
 * bottom panel — `login.spec.ts` — landing on the matching
 * `page.getByRole('button', { name: 'Log in' })` block, which lights up. The
 * selector that drove the click IS the one saved. The output is plain
 * @playwright/test you own.
 *
 * Flow name ("Log in") + spec file (login.spec.ts) match McpDemo / BusinessMapDemo.
 *
 * ANIMATION — one rAF lap clock drives the whole beat (click ripple → pulse down
 * the connector → code block reveal), so nothing drifts. prefers-reduced-motion
 * → static end state (button highlit, connector drawn, block lit). Pure SVG.
 */

const MINT = '#7CFFA8';
const BG = '#1a1a1a';
const BG2 = '#1c1c1e';
const BG3 = '#141414';
const FIELD = '#161617';
const LINE = '#2a2a2c';
const LINE2 = '#3a3a3c';
const TEXT = '#e5e7eb';
const MUTE = '#9ca3af';
const DIM = '#6b7280';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const VBW = 460;
const VBH = 478;

// Browser panel.
const BX = 12;
const BY = 12;
const BW = 436;
const BH = 194;

// "Log in" button — the grounded target (full-width pill in the login card).
const BTN_X = 32;
const BTN_Y = 148;
const BTN_W = 396;
const BTN_H = 32;
const BTN_CX = BTN_X + BTN_W / 2;
const BTN_CY = BTN_Y + BTN_H / 2;

// Code panel.
const CX = 12;
const CY = 258;
const CW = 436;
const CH = 208;

// The getByRole block highlight (lines 3–5) — left bar + full-width band.
const HL_Y = 345;
const HL_H = 66;

// Connector: straight down from the button, then a curve into the code block's
// left gutter bar — the pulse lands exactly where the selector is written.
const CONN = `M ${BTN_CX} ${BTN_Y + BTN_H} L ${BTN_CX} 224 C ${BTN_CX} 250 16 254 14 ${HL_Y}`;

const LAP_MS = 4200;

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smooth(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function RecordReplay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  const connRef = useRef<SVGPathElement>(null);
  const rippleRef = useRef<SVGCircleElement>(null);
  const pulseRef = useRef<SVGCircleElement>(null);
  const revealRef = useRef<SVGGElement>(null);
  const tagRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!run) return;
    const conn = connRef.current;
    if (!conn) return;
    const connLen = conn.getTotalLength();

    let raf = 0;
    let start = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const p = (((now - start) / LAP_MS) % 1 + 1) % 1;

      // Click ripple on the grounded button.
      const ripple = rippleRef.current;
      if (ripple) {
        const ru = smooth(0.05, 0.26, p);
        ripple.setAttribute('r', String(16 + ru * 34));
        ripple.setAttribute('opacity', String(p < 0.05 || p > 0.28 ? 0 : (1 - ru) * 0.6));
      }

      // Pulse travels down the connector into the spec block.
      const pulse = pulseRef.current;
      if (pulse) {
        const pu = clamp01((p - 0.22) / 0.36);
        if (p < 0.22 || p > 0.6) {
          pulse.setAttribute('opacity', '0');
        } else {
          const pt = conn.getPointAtLength(pu * connLen);
          pulse.setAttribute('cx', String(pt.x));
          pulse.setAttribute('cy', String(pt.y));
          pulse.setAttribute('opacity', String(Math.sin(pu * Math.PI) * 0.95));
        }
      }

      // Tag fades in as the pulse leaves the button; block reveals as it lands.
      const tag = smooth(0.16, 0.32, p) * (1 - smooth(0.94, 1, p));
      if (tagRef.current) tagRef.current.setAttribute('opacity', String(tag));
      const rev = smooth(0.54, 0.72, p) * (1 - smooth(0.94, 1, p));
      if (revealRef.current) revealRef.current.setAttribute('opacity', String(rev));

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  const staticOn = reduced ? 1 : 0;

  return (
    <div ref={rootRef} className="select-none" style={{ width: '100%', maxWidth: 430 }}>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        role="img"
        aria-label="record equals replay: the agent clicks the Log in button by role and name in the debug Chrome, and that exact selector is saved as page.getByRole('button', { name: 'Log in' }) in login.spec.ts — plain @playwright/test you own."
        style={{ display: 'block' }}
      >
        <defs>
          <filter id="rr-glow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id="rr-soft" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* ── Connector (behind everything) ── */}
        <path
          ref={connRef}
          d={CONN}
          fill="none"
          stroke={MINT}
          strokeOpacity={0.4}
          strokeWidth={1.5}
          strokeDasharray="2 4"
          strokeLinecap="round"
        />

        {/* ─────────────── Browser panel ─────────────── */}
        <rect x={BX} y={BY} width={BW} height={BH} rx={12} fill={BG2} stroke={LINE} />
        {/* title bar */}
        <circle cx={BX + 18} cy={BY + 16} r={3.5} fill={LINE2} />
        <circle cx={BX + 30} cy={BY + 16} r={3.5} fill={LINE2} />
        <circle cx={BX + 42} cy={BY + 16} r={3.5} fill={LINE2} />
        <rect x={BX + 68} y={BY + 7} width={256} height={18} rx={9} fill={BG3} stroke={LINE} />
        <text x={BX + 80} y={BY + 20} fontFamily={MONO} fontSize={10} fill={MUTE}>
          shop.acme.dev/login
        </text>
        <line x1={BX} y1={BY + 32} x2={BX + BW} y2={BY + 32} stroke={LINE} />

        {/* login card */}
        <text x={32} y={62} fontFamily={MONO} fontSize={9} fill={DIM} letterSpacing={0.6}>
          EMAIL
        </text>
        <rect x={32} y={68} width={396} height={26} rx={6} fill={FIELD} stroke={LINE} />
        <text x={44} y={85} fontFamily={MONO} fontSize={11} fill={MUTE}>
          shopper@acme.test
        </text>
        <text x={32} y={114} fontFamily={MONO} fontSize={9} fill={DIM} letterSpacing={0.6}>
          PASSWORD
        </text>
        <rect x={32} y={120} width={396} height={26} rx={6} fill={FIELD} stroke={LINE} />
        <text x={44} y={137} fontFamily={MONO} fontSize={11} fill={MUTE} letterSpacing={1}>
          ••••••••••
        </text>

        {/* the grounded target — "Log in" button (soft halo + ripple) */}
        <rect
          x={BTN_X}
          y={BTN_Y}
          width={BTN_W}
          height={BTN_H}
          rx={8}
          fill={MINT}
          opacity={0.16}
          filter="url(#rr-soft)"
        />
        <circle
          ref={rippleRef}
          cx={BTN_CX}
          cy={BTN_CY}
          r={16}
          fill="none"
          stroke={MINT}
          strokeWidth={2}
          opacity={staticOn ? 0 : 0}
        />
        <rect
          x={BTN_X}
          y={BTN_Y}
          width={BTN_W}
          height={BTN_H}
          rx={8}
          fill="rgba(124,255,168,0.12)"
          stroke={MINT}
          strokeWidth={1.4}
        />
        <text
          x={BTN_CX}
          y={BTN_CY + 4.5}
          textAnchor="middle"
          fontFamily={MONO}
          fontSize={13}
          fontWeight={600}
          fill={MINT}
        >
          Log in
        </text>
        {/* grounded annotation — one contiguous line */}
        <text x={32} y={192} fontFamily={MONO} fontSize={9.5} fill={DIM}>
          grounded · role=button · name=
          <tspan fill={MUTE}>{' '}&quot;Log in&quot;</tspan>
        </text>

        {/* ── "record == replay" tag, riding the connector in the gap ── */}
        <g ref={tagRef} opacity={staticOn}>
          <rect x={BTN_CX - 64} y={216} width={128} height={20} rx={6} fill={BG} stroke={MINT} strokeOpacity={0.45} />
          <text x={BTN_CX} y={230} textAnchor="middle" fontFamily={MONO} fontSize={10.5} fill={MINT} letterSpacing={0.3}>
            record == replay
          </text>
        </g>

        {/* ─────────────── Code panel ─────────────── */}
        <rect x={CX} y={CY} width={CW} height={CH} rx={12} fill={BG3} stroke={LINE} />
        {/* title bar — file glyph with a folded corner + filename */}
        <path
          d={`M 30 ${CY + 9} h8 l4 4 v9 h-12 z`}
          fill="none"
          stroke={LINE2}
          strokeWidth={1}
          strokeLinejoin="round"
        />
        <path d={`M 38 ${CY + 9} v4 h4`} fill="none" stroke={LINE2} strokeWidth={1} strokeLinejoin="round" />
        <text x={52} y={CY + 20} fontFamily={MONO} fontSize={11} fill={TEXT}>
          login.spec.ts
        </text>
        <text x={CX + CW - 14} y={CY + 20} textAnchor="end" fontFamily={MONO} fontSize={9} fill={DIM}>
          __vibe_tests__/
        </text>
        <line x1={CX} y1={CY + 30} x2={CX + CW} y2={CY + 30} stroke={LINE} />

        {/* reveal — highlight band + left bar behind the getByRole block */}
        <g ref={revealRef} opacity={staticOn}>
          <rect x={CX} y={HL_Y} width={CW} height={HL_H} fill="rgba(124,255,168,0.09)" />
          <rect x={CX} y={HL_Y} width={3} height={HL_H} fill={MINT} />
        </g>

        {/* code lines (indent via x offset; matched flow name in mint) */}
        <g fontFamily={MONO} fontSize={11.5}>
          <text x={30} y={310} fill={MUTE}>
            test(<tspan fill={TEXT}>&apos;login&apos;</tspan>, async ({'{ page }'}) =&gt; {'{'}
          </text>
          <text x={44} y={332} fill={MUTE}>
            await page.goto(<tspan fill={TEXT}>&apos;/login&apos;</tspan>);
          </text>
          <text x={44} y={354} fill={TEXT}>
            await page.getByRole(<tspan fill={MUTE}>&apos;button&apos;</tspan>, {'{'}
          </text>
          <text x={60} y={376} fill={TEXT}>
            name: <tspan fill={MINT}>&apos;Log in&apos;</tspan>,
          </text>
          <text x={44} y={398} fill={TEXT}>
            {'}'}).click();
          </text>
          <text x={30} y={420} fill={MUTE}>
            {'}'});
          </text>
        </g>

        {/* pulse riding the connector */}
        <circle ref={pulseRef} cx={BTN_CX} cy={BTN_Y + BTN_H} r={4} fill={MINT} filter="url(#rr-glow)" opacity={0} />
      </svg>
      <p className="mt-5 text-center text-sm text-text-mute">
        The agent drives once · you own plain{' '}
        <span className="font-mono text-mint">@playwright/test</span>
      </p>
    </div>
  );
}
