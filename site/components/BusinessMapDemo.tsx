'use client';

import { useRef } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * A static-but-polished mock of the VS Code cockpit's **Business Map** graph
 * for the Acme Store example (shop.acme.dev): a left-to-right flow from the app
 * root → areas (Auth / Commerce / Account) → business lines (individual flows)
 * → the crystallized spec nodes. Coverage-colored — a covered line gets a mint
 * border + ✓, an uncovered one is dim/gray + ○. The covered flows (Log in /
 * Add to cart / Checkout) and their spec leaves MUST match the specs the
 * McpDemo crystallizes. Pure SVG, no graph library (the site must not pull in
 * reactflow). The layout echoes the extension's flow graph so the marketing
 * surface and the product read as one thing.
 */

const MINT = '#7CFFA8';
const LINE = '#2a2a2c';
const LINE2 = '#3a3a3c';
const BG2 = '#222224';
const TEXT = '#e5e7eb';
const MUTE = '#9ca3af';
const DIM = '#6b7280';

type Flow = { label: string; covered: boolean; y: number };
type Area = { label: string; y: number; flows: Flow[] };

// Three columns: app (x≈70), areas (x≈250), business lines (x≈470).
const AREAS: Area[] = [
  {
    label: 'Auth',
    y: 70,
    flows: [
      { label: 'Log in', covered: true, y: 44 },
      { label: 'Sign up', covered: false, y: 96 },
    ],
  },
  {
    label: 'Commerce',
    y: 190,
    flows: [
      { label: 'Browse products', covered: false, y: 150 },
      { label: 'Add to cart', covered: true, y: 200 },
      { label: 'Checkout', covered: true, y: 250 },
      { label: 'Search', covered: false, y: 300 },
    ],
  },
  {
    label: 'Account',
    y: 330,
    flows: [{ label: 'Edit profile', covered: false, y: 345 }],
  },
];

const APP = { label: 'shop.acme.dev', x: 12, y: 195, w: 116, h: 40 };
const AREA_X = 176;
const AREA_W = 104;
const FLOW_X = 328;
const FLOW_W = 150;
// Three spec nodes hang off covered flows — matching the specs McpDemo writes:
// Log in → login.spec, Add to cart → add-to-cart.spec, Checkout → checkout.spec.
const SPECS = [
  { label: 'login.spec.ts', x: 506, y: 44 },
  { label: 'add-to-cart.spec.ts', x: 506, y: 200 },
  { label: 'checkout.spec.ts', x: 506, y: 250 },
];

function edge(x1: number, y1: number, x2: number, y2: number, active: boolean) {
  const mx = (x1 + x2) / 2;
  return {
    d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
    stroke: active ? 'rgba(124,255,168,0.45)' : LINE2,
  };
}

export function BusinessMapDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const animate = inView && !reduced;

  return (
    <div ref={rootRef} className="w-full">
      <div className="overflow-hidden rounded-xl border border-line bg-bg-3">
        {/* Title bar — mirrors the cockpit panel chrome */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[12px] text-text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Business Map · Acme Store
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] text-text-dim">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-[3px] border"
                style={{ borderColor: MINT, background: 'rgba(124,255,168,0.12)' }}
              />
              covered
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-[3px] border"
                style={{ borderColor: LINE2, background: BG2 }}
              />
              not yet
            </span>
          </div>
        </div>

        {/* The graph */}
        <div className="overflow-x-auto px-3 py-4">
          <svg
            viewBox="0 0 650 372"
            width="100%"
            role="img"
            aria-label="Business Map graph: app root to areas (Auth, Commerce, Account) to business lines, with covered flows linked to crystallized Playwright specs."
            style={{ minWidth: 560, display: 'block' }}
          >
            <style>{`
              @keyframes bm-dash { to { stroke-dashoffset: -16; } }
              .bm-edge-active { stroke-dasharray: 5 5; ${
                animate ? 'animation: bm-dash 0.9s linear infinite;' : ''
              } }
            `}</style>

            {/* ── Edges (drawn first, under nodes) ── */}
            {/* app → areas */}
            {AREAS.map((a) => {
              const e = edge(APP.x + APP.w, APP.y, AREA_X, a.y, a.flows.some((f) => f.covered));
              return (
                <path
                  key={`e-app-${a.label}`}
                  d={e.d}
                  fill="none"
                  stroke={e.stroke}
                  strokeWidth={1.5}
                  className={a.flows.some((f) => f.covered) ? 'bm-edge-active' : ''}
                />
              );
            })}
            {/* areas → flows */}
            {AREAS.flatMap((a) =>
              a.flows.map((f) => {
                const e = edge(AREA_X + AREA_W, a.y, FLOW_X, f.y, f.covered);
                return (
                  <path
                    key={`e-${a.label}-${f.label}`}
                    d={e.d}
                    fill="none"
                    stroke={e.stroke}
                    strokeWidth={1.5}
                    className={f.covered ? 'bm-edge-active' : ''}
                  />
                );
              }),
            )}
            {/* covered flows → spec nodes */}
            {(() => {
              const coveredFlows = AREAS.flatMap((a) => a.flows).filter((f) => f.covered);
              // login (y44) and checkout (y210) — match to SPECS by y.
              return SPECS.map((s) => {
                const src = coveredFlows.find((f) => f.y === s.y);
                if (!src) return null;
                const e = edge(FLOW_X + FLOW_W, src.y, s.x, s.y, true);
                return (
                  <path
                    key={`e-spec-${s.label}`}
                    d={e.d}
                    fill="none"
                    stroke={e.stroke}
                    strokeWidth={1.5}
                    className="bm-edge-active"
                  />
                );
              });
            })()}

            {/* ── App root node ── */}
            <g>
              <rect
                x={APP.x}
                y={APP.y - APP.h / 2}
                width={APP.w}
                height={APP.h}
                rx={9}
                fill={BG2}
                stroke={MINT}
                strokeWidth={1.5}
              />
              <text
                x={APP.x + APP.w / 2}
                y={APP.y + 4}
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
                fontSize={12}
                fontWeight={600}
                fill={TEXT}
              >
                {APP.label}
              </text>
            </g>

            {/* ── Area nodes ── */}
            {AREAS.map((a) => (
              <g key={`area-${a.label}`}>
                <rect
                  x={AREA_X}
                  y={a.y - 16}
                  width={AREA_W}
                  height={32}
                  rx={8}
                  fill={BG2}
                  stroke={LINE2}
                  strokeWidth={1.25}
                />
                <text
                  x={AREA_X + AREA_W / 2}
                  y={a.y + 4}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  fontSize={12}
                  fontWeight={600}
                  fill={TEXT}
                >
                  {a.label}
                </text>
              </g>
            ))}

            {/* ── Flow (business line) nodes ── */}
            {AREAS.flatMap((a) =>
              a.flows.map((f) => (
                <g key={`flow-${f.label}`}>
                  <rect
                    x={FLOW_X}
                    y={f.y - 14}
                    width={FLOW_W}
                    height={28}
                    rx={8}
                    fill={f.covered ? 'rgba(124,255,168,0.07)' : BG2}
                    stroke={f.covered ? MINT : LINE2}
                    strokeWidth={f.covered ? 1.5 : 1.25}
                  />
                  <text
                    x={FLOW_X + 14}
                    y={f.y + 4}
                    textAnchor="start"
                    fontFamily="ui-monospace, monospace"
                    fontSize={11.5}
                    fill={f.covered ? TEXT : MUTE}
                  >
                    {f.label}
                  </text>
                  <text
                    x={FLOW_X + FLOW_W - 13}
                    y={f.y + 4.5}
                    textAnchor="middle"
                    fontFamily="ui-monospace, monospace"
                    fontSize={12}
                    fontWeight={700}
                    fill={f.covered ? MINT : DIM}
                  >
                    {f.covered ? '✓' : '○'}
                  </text>
                </g>
              )),
            )}

            {/* ── Spec nodes (leaves) ── */}
            {SPECS.map((s) => (
              <g key={`spec-${s.label}`}>
                <rect
                  x={s.x}
                  y={s.y - 13}
                  width={130}
                  height={26}
                  rx={7}
                  fill={BG2}
                  stroke={MINT}
                  strokeWidth={1.25}
                  strokeDasharray="0"
                />
                <text
                  x={s.x + 11}
                  y={s.y + 4}
                  textAnchor="start"
                  fontFamily="ui-monospace, monospace"
                  fontSize={11}
                  fill={MINT}
                >
                  {s.label}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* Footer status row — like the cockpit's coverage summary */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 font-mono text-[11px] text-text-dim">
          <span>
            <span className="text-mint">3</span> of <span className="text-text-mute">7</span> flows
            covered
          </span>
          <span>3 specs · __vibe_tests__/</span>
        </div>
      </div>
    </div>
  );
}
