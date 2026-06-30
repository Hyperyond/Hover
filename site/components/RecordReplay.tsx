'use client';

import { useEffect, useRef } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * The hero-right visual: Hover's moat — **record == replay** — drawn directly.
 *
 * Top: the user's debug Chrome on the Acme Store login (shop.acme.dev/login).
 * The agent acts through a GROUNDED control — it clicks the "Log in" button by
 * role+name (a click ripple fires). A connector carries that exact target down
 * into the bottom panel — `login.spec.ts` — where it lands as the matching
 * `page.getByRole('button', { name: 'Log in' })` line, which lights up. The
 * selector that drove the click IS the one saved: record == replay. The output
 * is plain @playwright/test you own.
 *
 * Flow name ("Log in") + spec file (login.spec.ts) match McpDemo / BusinessMapDemo.
 *
 * ANIMATION — one rAF lap clock drives the whole beat (click ripple → pulse down
 * the connector → code lines reveal), so nothing can drift. prefers-reduced-
 * motion → static end state: button highlit, connector drawn, code lines lit.
 * Pure SVG, no graph/animation library.
 */

const MINT = '#7CFFA8';
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
const VBH = 462;

// Browser panel.
const BX = 12;
const BY = 12;
const BW = 436;
const BH = 192;
// "Log in" button (the grounded target) — full-width pill in the login card.
const BTN_X = 32;
const BTN_Y = 150;
const BTN_W = 396;
const BTN_H = 32;
const BTN_CX = BTN_X + BTN_W / 2;
const BTN_CY = BTN_Y + BTN_H / 2;

// Code panel.
const CX = 12;
const CY = 250;
const CW = 436;
const CH = 200;
// Highlighted code lines (the getByRole block) — left gutter bar + band.
const HL_Y = 338;
const HL_H = 66;

// The connector from the button down into the code's left gutter.
const CONN = `M ${BTN_CX} ${BTN_Y + BTN_H} C ${BTN_CX} 222 22 248 18 ${HL_Y + 6}`;

const LAP_MS = 4000;

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

      // Click ripple on the grounded button — fires near the top of the lap.
      const ru = smooth(0.06, 0.28, p);
      const ripple = rippleRef.current;
      if (ripple) {
        ripple.setAttribute('r', String(14 + ru * 30));
        ripple.setAttribute('opacity', String(p < 0.06 || p > 0.3 ? 0 : (1 - ru) * 0.7));
      }

      // Pulse travels down the connector into the spec.
      const pulse = pulseRef.current;
      if (pulse) {
        const pu = clamp01((p - 0.24) / 0.34);
        if (p < 0.24 || p > 0.6) {
          pulse.setAttribute('opacity', '0');
        } else {
          const pt = conn.getPointAtLength(pu * connLen);
          pulse.setAttribute('cx', String(pt.x));
          pulse.setAttribute('cy', String(pt.y));
          pulse.setAttribute('opacity', String(Math.sin(pu * Math.PI) * 0.95));
        }
      }

      // Code lines reveal as the pulse lands; the tag fades in with them.
      const rev = smooth(0.56, 0.74, p) * (1 - smooth(0.95, 1, p));
      if (revealRef.current) revealRef.current.setAttribute('opacity', String(rev));
      if (tagRef.current) tagRef.current.setAttribute('opacity', String(rev));

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);

  const revealStatic = reduced ? 1 : 0;

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
          <filter id="rr-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        {/* ── Connector (drawn first, behind the panels' content edges) ── */}
        <path
          ref={connRef}
          d={CONN}
          fill="none"
          stroke={MINT}
          strokeOpacity={0.45}
          strokeWidth={1.5}
          strokeDasharray="3 4"
        />
        {/* "record == replay" tag riding the connector */}
        <g ref={tagRef} opacity={revealStatic}>
          <rect x={150} y={210} width={132} height={20} rx={6} fill={BG3} stroke={MINT} strokeOpacity={0.4} />
          <text x={216} y={224} textAnchor="middle" fontFamily={MONO} fontSize={10.5} fill={MINT} letterSpacing={0.3}>
            record == replay
          </text>
        </g>

        {/* ─────────────── Browser panel ─────────────── */}
        <rect x={BX} y={BY} width={BW} height={BH} rx={12} fill={BG2} stroke={LINE} />
        {/* title bar */}
        <circle cx={BX + 18} cy={BY + 16} r={3.5} fill={LINE2} />
        <circle cx={BX + 30} cy={BY + 16} r={3.5} fill={LINE2} />
        <circle cx={BX + 42} cy={BY + 16} r={3.5} fill={LINE2} />
        <rect x={BX + 70} y={BY + 7} width={250} height={18} rx={9} fill={BG3} stroke={LINE} />
        <text x={BX + 82} y={BY + 20} fontFamily={MONO} fontSize={10} fill={MUTE}>
          shop.acme.dev/login
        </text>
        <line x1={BX} y1={BY + 32} x2={BX + BW} y2={BY + 32} stroke={LINE} />

        {/* login card */}
        <text x={32} y={62} fontFamily={MONO} fontSize={9.5} fill={DIM} letterSpacing={0.5}>
          EMAIL
        </text>
        <rect x={32} y={68} width={396} height={26} rx={6} fill={FIELD} stroke={LINE} />
        <text x={44} y={85} fontFamily={MONO} fontSize={11} fill={MUTE}>
          shopper@acme.test
        </text>
        <text x={32} y={114} fontFamily={MONO} fontSize={9.5} fill={DIM} letterSpacing={0.5}>
          PASSWORD
        </text>
        <rect x={32} y={120} width={396} height={26} rx={6} fill={FIELD} stroke={LINE} />
        <text x={44} y={137} fontFamily={MONO} fontSize={11} fill={MUTE}>
          ••••••••••
        </text>

        {/* the grounded target — "Log in" button */}
        <circle
          ref={rippleRef}
          cx={BTN_CX}
          cy={BTN_CY}
          r={14}
          fill="none"
          stroke={MINT}
          strokeWidth={2}
          opacity={0}
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
        {/* grounded annotation */}
        <text x={32} y={196} fontFamily={MONO} fontSize={9.5} fill={DIM}>
          grounded · role=button · name=
        </text>
        <text x={233} y={196} fontFamily={MONO} fontSize={9.5} fill={MUTE}>
          &quot;Log in&quot;
        </text>

        {/* ─────────────── Code panel ─────────────── */}
        <rect x={CX} y={CY} width={CW} height={CH} rx={12} fill={BG3} stroke={LINE} />
        {/* title bar */}
        <rect x={CX + 18} y={CY + 9} width={12} height={14} rx={2} fill="none" stroke={LINE2} />
        <text x={CX + 38} y={CY + 20} fontFamily={MONO} fontSize={11} fill={TEXT}>
          login.spec.ts
        </text>
        <text x={CX + CW - 14} y={CY + 20} textAnchor="end" fontFamily={MONO} fontSize={9} fill={DIM}>
          __vibe_tests__/
        </text>
        <line x1={CX} y1={CY + 30} x2={CX + CW} y2={CY + 30} stroke={LINE} />

        {/* reveal group — the highlight band + left bar behind the getByRole block */}
        <g ref={revealRef} opacity={revealStatic}>
          <rect x={CX} y={HL_Y} width={CW} height={HL_H} fill="rgba(124,255,168,0.09)" />
          <rect x={CX} y={HL_Y} width={3} height={HL_H} fill={MINT} />
        </g>

        {/* code lines (indent via x offset; the matched flow name in mint) */}
        <g fontFamily={MONO} fontSize={11.5}>
          <text x={30} y={302} fill={MUTE}>
            test(<tspan fill={TEXT}>&apos;login&apos;</tspan>, async ({'{ page }'}) =&gt; {'{'}
          </text>
          <text x={44} y={324} fill={MUTE}>
            await page.goto(<tspan fill={TEXT}>&apos;/login&apos;</tspan>);
          </text>
          <text x={44} y={356} fill={TEXT}>
            await page.getByRole(<tspan fill={MUTE}>&apos;button&apos;</tspan>, {'{'}
          </text>
          <text x={58} y={378} fill={TEXT}>
            name: <tspan fill={MINT}>&apos;Log in&apos;</tspan>,
          </text>
          <text x={44} y={400} fill={TEXT}>
            {'}'}).click();
          </text>
          <text x={30} y={422} fill={MUTE}>
            {'}'});
          </text>
        </g>

        {/* pulse dot riding the connector */}
        <circle ref={pulseRef} cx={BTN_CX} cy={BTN_Y + BTN_H} r={4} fill={MINT} filter="url(#rr-glow)" opacity={0} />
      </svg>
      <p className="mt-4 text-center text-sm text-mute">
        The agent drives once · you own plain{' '}
        <span className="font-mono text-mint">@playwright/test</span>
      </p>
    </div>
  );
}
