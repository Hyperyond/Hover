'use client';

import { useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * A static-but-polished mock of the VS Code cockpit's **Business Map** graph
 * for the Acme Store example (shop.acme.dev). Two views over the SAME nodes,
 * switched by a Flow | Wiki toggle:
 *
 *  • Flow — the hierarchical left-to-right tree: app root → areas (Auth /
 *    Commerce / Account) → business lines (individual flows) → the crystallized
 *    spec nodes. Coverage-colored — a covered line gets a mint border + ✓, an
 *    uncovered one is dim/gray + ○.
 *  • Wiki — a knowledge-graph view: the flow nodes rearrange into a looser
 *    network and CROSS-LINK relationship edges appear between business lines
 *    (depends-on / leads-to / relates-to) that the hierarchy can't show. This
 *    is the point: `.hover/` is a living TEST WIKI, not just a tree.
 *
 * The covered flows (Log in / Add to cart / Checkout) and their spec leaves
 * MUST match the specs the McpDemo crystallizes. Pure SVG, no graph library
 * (the site must not pull in reactflow). The transition tweens node transforms
 * (~480ms) and fades the cross-links in; prefers-reduced-motion switches
 * instantly.
 */

const MINT = '#7CFFA8';
const LINE2 = '#3a3a3c';
const BG2 = '#222224';
const TEXT = '#e5e7eb';
const MUTE = '#9ca3af';
const DIM = '#6b7280';

type Mode = 'flow' | 'wiki';

type FlowNode = {
  id: string;
  label: string;
  covered: boolean;
  area: string;
  // Flow (tree) position — the row in its area column.
  fx: number;
  fy: number;
  // Wiki (network) position — looser scatter.
  wx: number;
  wy: number;
};

const FLOW_W = 150;
const FLOW_H = 28;

// Flow column x positions.
const APP = { label: 'shop.acme.dev', x: 12, y: 195, w: 116, h: 40 };
const AREA_X = 176;
const AREA_W = 104;
const FLOW_X = 328;

type Area = { label: string; y: number };
const AREAS: Area[] = [
  { label: 'Auth', y: 70 },
  { label: 'Commerce', y: 200 },
  { label: 'Account', y: 330 },
];

// Each flow carries BOTH its Flow-tree slot (fx/fy = top-left of FLOW_W×FLOW_H
// box) and its Wiki-network slot. Wiki positions cluster covered flows toward
// the centre and spread the network so cross-links read cleanly.
const FLOWS: FlowNode[] = [
  { id: 'login', label: 'Log in', covered: true, area: 'Auth', fx: FLOW_X, fy: 30, wx: 120, wy: 56 },
  { id: 'signup', label: 'Sign up', covered: false, area: 'Auth', fx: FLOW_X, fy: 82, wx: 96, wy: 250 },
  { id: 'browse', label: 'Browse products', covered: false, area: 'Commerce', fx: FLOW_X, fy: 136, wx: 360, wy: 56 },
  { id: 'cart', label: 'Add to cart', covered: true, area: 'Commerce', fx: FLOW_X, fy: 186, wx: 470, wy: 168 },
  { id: 'checkout', label: 'Checkout', covered: true, area: 'Commerce', fx: FLOW_X, fy: 236, wx: 300, wy: 248 },
  { id: 'search', label: 'Search', covered: false, area: 'Commerce', fx: FLOW_X, fy: 286, wx: 470, wy: 300 },
  { id: 'profile', label: 'Edit profile', covered: false, area: 'Account', fx: FLOW_X, fy: 331, wx: 96, wy: 150 },
];

// Spec leaves hang off covered flows (Flow view only).
const SPECS = [
  { id: 'login', label: 'login.spec.ts', x: 506, y: 44 },
  { id: 'cart', label: 'add-to-cart.spec.ts', x: 506, y: 200 },
  { id: 'checkout', label: 'checkout.spec.ts', x: 506, y: 250 },
];

// Cross-link relationships — the graph edges the hierarchy doesn't have. These
// only render in the Wiki view.
type Rel = { from: string; to: string; label: string };
const RELS: Rel[] = [
  { from: 'checkout', to: 'login', label: 'depends on' },
  { from: 'cart', to: 'checkout', label: 'leads to' },
  { from: 'search', to: 'browse', label: 'relates to' },
  { from: 'profile', to: 'login', label: 'depends on' },
];

function center(n: FlowNode, mode: Mode) {
  const x = mode === 'flow' ? n.fx : n.wx;
  const y = mode === 'flow' ? n.fy : n.wy;
  return { cx: x + FLOW_W / 2, cy: y + FLOW_H / 2, x, y };
}

// Hierarchy edge as a cubic curve between two points.
function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export function BusinessMapDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const animate = inView && !reduced;

  const [mode, setMode] = useState<Mode>('flow');
  // Gate the dashed-flow animation when in view; transition tween itself is CSS.
  const dash = animate && mode === 'flow';

  // Reduced motion: no CSS transition (instant switch). Otherwise tween ~480ms.
  const tween = reduced ? 'none' : 'transform 480ms cubic-bezier(0.4, 0, 0.2, 1)';
  const fade = reduced
    ? 'none'
    : 'opacity 420ms ease, stroke-dashoffset 0.9s linear';

  return (
    <div ref={rootRef} className="w-full">
      <div className="overflow-hidden rounded-xl border border-line bg-bg-3">
        {/* Title bar — mirrors the cockpit panel chrome + the Flow|Wiki toggle */}
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[12px] text-text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Business Map · Acme Store
          </div>
          <div
            className="flex items-center gap-0.5 rounded-lg border border-line p-0.5"
            style={{ background: BG2 }}
            role="tablist"
            aria-label="Business Map view"
          >
            {(['flow', 'wiki'] as Mode[]).map((m) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMode(m)}
                  className="rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors"
                  style={{
                    background: active ? 'rgba(124,255,168,0.12)' : 'transparent',
                    color: active ? MINT : MUTE,
                    border: active ? '1px solid rgba(124,255,168,0.45)' : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  {m === 'flow' ? 'Flow' : 'Wiki'}
                </button>
              );
            })}
          </div>
        </div>

        {/* The graph */}
        <div className="overflow-x-auto px-3 py-4">
          <svg
            viewBox="0 0 680 372"
            width="100%"
            role="img"
            aria-label={
              mode === 'flow'
                ? 'Business Map flow view: app root to areas (Auth, Commerce, Account) to business lines, with covered flows linked to crystallized Playwright specs.'
                : 'Business Map wiki view: business-line nodes in a network with cross-link relationship edges (depends on, leads to, relates to) — the living test wiki.'
            }
            style={{ minWidth: 580, display: 'block' }}
          >
            <style>{`
              @keyframes bm-dash { to { stroke-dashoffset: -16; } }
              .bm-edge-active { stroke-dasharray: 5 5; ${
                dash ? 'animation: bm-dash 0.9s linear infinite;' : ''
              } }
            `}</style>

            {/* ── Hierarchy edges (Flow view) — fade out in Wiki ── */}
            <g style={{ opacity: mode === 'flow' ? 1 : 0, transition: fade }}>
              {/* app → areas */}
              {AREAS.map((a) => {
                const areaCovered = FLOWS.some((f) => f.area === a.label && f.covered);
                return (
                  <path
                    key={`e-app-${a.label}`}
                    d={edgePath(APP.x + APP.w, APP.y, AREA_X, a.y)}
                    fill="none"
                    stroke={areaCovered ? 'rgba(124,255,168,0.45)' : LINE2}
                    strokeWidth={1.5}
                    className={areaCovered ? 'bm-edge-active' : ''}
                  />
                );
              })}
              {/* areas → flows */}
              {FLOWS.map((f) => {
                const a = AREAS.find((ar) => ar.label === f.area)!;
                return (
                  <path
                    key={`e-${f.id}`}
                    d={edgePath(AREA_X + AREA_W, a.y, FLOW_X, f.fy + FLOW_H / 2)}
                    fill="none"
                    stroke={f.covered ? 'rgba(124,255,168,0.45)' : LINE2}
                    strokeWidth={1.5}
                    className={f.covered ? 'bm-edge-active' : ''}
                  />
                );
              })}
              {/* covered flows → spec nodes */}
              {SPECS.map((s) => {
                const src = FLOWS.find((f) => f.id === s.id)!;
                return (
                  <path
                    key={`e-spec-${s.id}`}
                    d={edgePath(FLOW_X + FLOW_W, src.fy + FLOW_H / 2, s.x, s.y)}
                    fill="none"
                    stroke="rgba(124,255,168,0.45)"
                    strokeWidth={1.5}
                    className="bm-edge-active"
                  />
                );
              })}
            </g>

            {/* ── Cross-link relationship edges (Wiki view) — fade in ── */}
            <g style={{ opacity: mode === 'wiki' ? 1 : 0, transition: fade }}>
              {RELS.map((r) => {
                const from = FLOWS.find((f) => f.id === r.from)!;
                const to = FLOWS.find((f) => f.id === r.to)!;
                const a = center(from, 'wiki');
                const b = center(to, 'wiki');
                const mx = (a.cx + b.cx) / 2;
                const my = (a.cy + b.cy) / 2;
                return (
                  <g key={`rel-${r.from}-${r.to}`}>
                    <line
                      x1={a.cx}
                      y1={a.cy}
                      x2={b.cx}
                      y2={b.cy}
                      stroke="rgba(124,255,168,0.5)"
                      strokeWidth={1.25}
                      strokeDasharray="4 4"
                      style={{ transition: tween }}
                    />
                    <rect
                      x={mx - r.label.length * 3.1 - 5}
                      y={my - 8}
                      width={r.label.length * 6.2 + 10}
                      height={15}
                      rx={4}
                      fill="#141414"
                      stroke="rgba(124,255,168,0.3)"
                      strokeWidth={0.75}
                      style={{ transition: tween }}
                    />
                    <text
                      x={mx}
                      y={my + 2.5}
                      textAnchor="middle"
                      fontFamily="ui-monospace, monospace"
                      fontSize={8.5}
                      fill="rgba(124,255,168,0.85)"
                      style={{ transition: tween }}
                    >
                      {r.label}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* ── App root node (Flow view only) ── */}
            <g style={{ opacity: mode === 'flow' ? 1 : 0, transition: fade }}>
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

            {/* ── Area nodes (Flow view only) ── */}
            <g style={{ opacity: mode === 'flow' ? 1 : 0, transition: fade }}>
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
            </g>

            {/* ── Spec nodes (leaves, Flow view only) ── */}
            <g style={{ opacity: mode === 'flow' ? 1 : 0, transition: fade }}>
              {SPECS.map((s) => (
                <g key={`spec-${s.id}`}>
                  <rect
                    x={s.x}
                    y={s.y - 13}
                    width={130}
                    height={26}
                    rx={7}
                    fill={BG2}
                    stroke={MINT}
                    strokeWidth={1.25}
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
            </g>

            {/* ── Flow (business line) nodes — the SAME nodes in both views, ──
                their <g transform> tweens between Flow slot and Wiki slot. */}
            {FLOWS.map((f) => {
              const p = center(f, mode);
              return (
                <g
                  key={`flow-${f.id}`}
                  style={{
                    transform: `translate(${p.x}px, ${p.y}px)`,
                    transition: tween,
                  }}
                >
                  <rect
                    x={0}
                    y={0}
                    width={FLOW_W}
                    height={FLOW_H}
                    rx={8}
                    fill={f.covered ? 'rgba(124,255,168,0.07)' : BG2}
                    stroke={f.covered ? MINT : LINE2}
                    strokeWidth={f.covered ? 1.5 : 1.25}
                  />
                  <text
                    x={14}
                    y={FLOW_H / 2 + 4}
                    textAnchor="start"
                    fontFamily="ui-monospace, monospace"
                    fontSize={11.5}
                    fill={f.covered ? TEXT : MUTE}
                  >
                    {f.label}
                  </text>
                  <text
                    x={FLOW_W - 13}
                    y={FLOW_H / 2 + 4.5}
                    textAnchor="middle"
                    fontFamily="ui-monospace, monospace"
                    fontSize={12}
                    fontWeight={700}
                    fill={f.covered ? MINT : DIM}
                  >
                    {f.covered ? '✓' : '○'}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Footer status row — like the cockpit's coverage summary */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 font-mono text-[11px] text-text-dim">
          <span>
            <span className="text-mint">3</span> of <span className="text-text-mute">7</span> flows
            covered
          </span>
          <span>{mode === 'flow' ? 'by area' : '+ relationships — your app’s living test wiki'}</span>
        </div>
      </div>
    </div>
  );
}
