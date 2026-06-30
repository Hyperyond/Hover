'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * The hero-right visual: Hover's lifecycle as a continuous CLOSED LOOP.
 *
 *   Author · MCP → Review · VS Code → Run · CI → Watch · Cloud → (back to Author)
 *
 * Four stage nodes sit at the cardinal points of a rounded-rectangle
 * "racetrack". A mint comet travels clockwise along the path forever; as it
 * passes each node, that node lights up (mint glow + scale) in sequence, then
 * dims as the comet moves on. The Watch→Author edge is the feedback edge that
 * closes the loop (monitoring / self-heal feeds back into authoring) — drawn
 * dashed + labelled so it reads as "the loop closes".
 *
 * The CENTER is the payoff: the through-line artifact — `@playwright/test`,
 * "you own it" — the thing that persists while the loop spins around it.
 *
 * Pure SVG + CSS. Gated with useInView (no work offscreen). prefers-reduced-
 * motion → fully static: the loop, all four nodes, the closing arrow, no motion.
 */

const MINT = '#7CFFA8';
const BG = '#1a1a1a';
const BG2 = '#222224';
const BG3 = '#141414';
const LINE = '#2a2a2c';
const LINE2 = '#3a3a3c';
const TEXT = '#e5e7eb';
const MUTE = '#9ca3af';
const DIM = '#6b7280';

const VB = 440; // square viewBox

// Racetrack geometry — a rounded rectangle centred in the viewBox. Nodes hang
// off the four cardinal midpoints of this rect.
const PAD = 70; // distance from viewBox edge to the track rect
const R = 64; // corner radius of the racetrack
const X0 = PAD;
const Y0 = PAD;
const X1 = VB - PAD;
const Y1 = VB - PAD;
const CX = VB / 2;
const CY = VB / 2;

type StageDef = {
  k: string;
  stage: string;
  surface: string;
  n: number; // step number
  planned?: boolean;
  // node centre (a cardinal midpoint of the track rect)
  nx: number;
  ny: number;
};

// Order is clockwise starting at the top, matching the comet's travel:
// Author (top) → Review (right) → Run (bottom) → Watch (left) → back to Author.
const STAGES: StageDef[] = [
  { k: 'author', stage: 'Author', surface: 'MCP', n: 1, nx: CX, ny: Y0 },
  { k: 'review', stage: 'Review', surface: 'VS Code', n: 2, nx: X1, ny: CY },
  { k: 'run', stage: 'Run', surface: 'CI', n: 3, nx: CX, ny: Y1 },
  { k: 'watch', stage: 'Watch', surface: 'Cloud', n: 4, planned: true, nx: X0, ny: CY },
];

// The clockwise racetrack path, starting at the top-centre (Author) so the
// comet's dashoffset 0 sits on the first node. Drawn with arcs at the corners.
//   top-centre → top-right corner → right-centre (Review) → bottom-right
//   → bottom-centre (Run) → bottom-left → left-centre (Watch) → top-left → close
const TRACK = [
  `M ${CX} ${Y0}`,
  `L ${X1 - R} ${Y0}`,
  `A ${R} ${R} 0 0 1 ${X1} ${Y0 + R}`,
  `L ${X1} ${Y1 - R}`,
  `A ${R} ${R} 0 0 1 ${X1 - R} ${Y1}`,
  `L ${X0 + R} ${Y1}`,
  `A ${R} ${R} 0 0 1 ${X0} ${Y1 - R}`,
  `L ${X0} ${Y0 + R}`,
  `A ${R} ${R} 0 0 1 ${X0 + R} ${Y0}`,
  `Z`,
].join(' ');

const LAP_MS = 7600; // one full clockwise lap

export function LoopDiagram() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  // Which node is currently "active" (lit). Driven by a JS interval that steps
  // in lockstep with the comet (4 quarters per lap). When not running we leave
  // it null so the static fallback shows every node in its calm state but with
  // the loop fully drawn.
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!run) {
      setActive(null);
      return;
    }
    const step = LAP_MS / STAGES.length;
    // Light the first node immediately, then advance each quarter-lap.
    setActive(0);
    const id = setInterval(() => {
      setActive((a) => ((a ?? 0) + 1) % STAGES.length);
    }, step);
    return () => clearInterval(id);
  }, [run]);

  return (
    <div ref={rootRef} className="select-none" style={{ width: 440, maxWidth: '100%' }}>
      <svg
            viewBox={`0 0 ${VB} ${VB}`}
            width="100%"
            role="img"
            aria-label="Hover's closed lifecycle loop: Author (MCP) → Review (VS Code) → Run (CI) → Watch (Cloud, planned) → back to Author. The four stages run around the @playwright/test suite you own, which persists at the centre."
            style={{ display: 'block' }}
          >
            <defs>
              {/* Comet gradient — a bright mint head fading to transparent tail. */}
              <linearGradient id="loop-comet" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={MINT} stopOpacity="0" />
                <stop offset="80%" stopColor={MINT} stopOpacity="0.55" />
                <stop offset="100%" stopColor={MINT} stopOpacity="1" />
              </linearGradient>
              <radialGradient id="loop-center-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(124,255,168,0.16)" />
                <stop offset="100%" stopColor="rgba(124,255,168,0)" />
              </radialGradient>
              {/* Arrowheads pointing along travel — mint for live edges, dim for feedback. */}
              <marker
                id="loop-arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={MINT} fillOpacity="0.7" />
              </marker>
              <marker
                id="loop-arrow-dim"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={MUTE} fillOpacity="0.8" />
              </marker>
            </defs>

            <style>{`
              @keyframes loop-comet-run {
                from { stroke-dashoffset: 0; }
                to   { stroke-dashoffset: var(--loop-len); }
              }
              @keyframes loop-feedback-dash { to { stroke-dashoffset: -14; } }
            `}</style>

            {/* ── The track ─────────────────────────────────────────────
                base hairline + an active mint edge (the three "live" sides
                Author→Review→Run→Watch) + the dashed FEEDBACK edge that closes
                the loop. Arrowheads sit at the node entries. */}

            {/* Base track — full racetrack, faint. */}
            <path d={TRACK} fill="none" stroke={LINE2} strokeWidth={2} strokeLinecap="round" />

            {/* Directional arrowheads along the three live edges, placed just
                before each downstream node so travel direction reads clearly. */}
            <LiveArrows />

            {/* The closing FEEDBACK edge (Watch → Author): the left+top inner
                run, drawn dashed in muted tone with its own arrowhead into
                Author, plus a "self-heal feeds back" label. This is the part
                that makes the loop legible as closed. */}
            <FeedbackEdge animate={run} />

            {/* ── The comet — a bright dash chasing clockwise around the track.
                We animate stroke-dashoffset on a copy of the track path; the
                visible "dash" is the comet head + a short tail, the gap is the
                rest of the lap. CSS var --loop-len = full path length so the
                offset animation completes exactly one lap. */}
            {run && (
              <path
                d={TRACK}
                fill="none"
                stroke="url(#loop-comet)"
                strokeWidth={3}
                strokeLinecap="round"
                pathLength={1000}
                style={
                  {
                    // 60-unit dash (comet) + 940 gap; offset sweeps a full 1000.
                    strokeDasharray: '60 940',
                    ['--loop-len' as string]: '-1000',
                    animation: `loop-comet-run ${LAP_MS}ms linear infinite`,
                  } as React.CSSProperties
                }
              />
            )}

            {/* ── Centre artifact — the through-line you own ── */}
            <CenterArtifact />

            {/* ── Stage nodes ── */}
            {STAGES.map((s, i) => (
              <StageNode key={s.k} s={s} lit={active === i} reduced={reduced} />
            ))}
      </svg>
    </div>
  );
}

/* ── Centre: the owned @playwright/test artifact ──────────────────────── */
function CenterArtifact() {
  return (
    <g>
      {/* soft glow puddle so the centre reads as the "core" — no card, text only */}
      <circle cx={CX} cy={CY} r={120} fill="url(#loop-center-glow)" />
      <text
        x={CX}
        y={CY - 16}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize={10}
        fill={DIM}
        letterSpacing={1.5}
      >
        YOUR SUITE
      </text>
      <text
        x={CX}
        y={CY + 6}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize={15}
        fontWeight={600}
        fill={MINT}
      >
        @playwright/test
      </text>
      <text
        x={CX}
        y={CY + 26}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize={10.5}
        fill={MUTE}
      >
        you own it
      </text>
    </g>
  );
}

/* ── A stage node — pill card hung off a cardinal midpoint ──────────────
 * Anchored so the pill is centred on (nx, ny). Lit state = mint glow + scale.
 * The planned (Watch) node gets a dashed, dimmer treatment. */
function StageNode({
  s,
  lit,
  reduced,
}: {
  s: StageDef;
  lit: boolean;
  reduced: boolean;
}) {
  const W = 116;
  const H = 56;
  const x = s.nx - W / 2;
  const y = s.ny - H / 2;

  const accent = s.planned ? MUTE : MINT;
  // Calm vs lit. Planned node stays dimmer even when lit.
  const stroke = lit ? accent : s.planned ? LINE2 : LINE;
  const strokeOpacity = lit ? 1 : s.planned ? 0.9 : 1;
  const fill = lit
    ? s.planned
      ? 'rgba(156,163,175,0.07)'
      : 'rgba(124,255,168,0.10)'
    : BG2;

  const tween = reduced ? undefined : 'transform 360ms cubic-bezier(0.4,0,0.2,1)';
  const scale = lit ? 1.06 : 1;

  return (
    <g
      style={{
        transform: `translate(${s.nx}px, ${s.ny}px) scale(${scale}) translate(${-s.nx}px, ${-s.ny}px)`,
        transition: tween,
      }}
    >
      {/* lit glow ring */}
      {lit && !s.planned && (
        <rect
          x={x - 4}
          y={y - 4}
          width={W + 8}
          height={H + 8}
          rx={14}
          fill="none"
          stroke={MINT}
          strokeOpacity={0.28}
          strokeWidth={6}
        />
      )}
      <rect
        x={x}
        y={y}
        width={W}
        height={H}
        rx={11}
        fill={fill}
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={lit && !s.planned ? 1.75 : 1.25}
        strokeDasharray={s.planned ? '4 3' : undefined}
      />
      {/* step number badge */}
      <circle
        cx={x + 16}
        cy={y + 16}
        r={9}
        fill={BG3}
        stroke={lit ? accent : LINE2}
        strokeWidth={1.25}
      />
      <text
        x={x + 16}
        y={y + 19.5}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize={9.5}
        fontWeight={700}
        fill={lit ? accent : MUTE}
      >
        {s.n}
      </text>
      {/* stage label */}
      <text
        x={x + 32}
        y={y + 21}
        textAnchor="start"
        fontFamily="ui-monospace, monospace"
        fontSize={13.5}
        fontWeight={600}
        fill={lit ? (s.planned ? TEXT : MINT) : TEXT}
      >
        {s.stage}
      </text>
      {/* surface sub-label */}
      <text
        x={x + 14}
        y={y + 41}
        textAnchor="start"
        fontFamily="ui-monospace, monospace"
        fontSize={10.5}
        fill={s.planned && !lit ? DIM : MUTE}
      >
        {s.surface}
        {s.planned ? '  · planned' : ''}
      </text>
    </g>
  );
}

/* ── Directional arrowheads on the three "live" edges ───────────────────
 * Tiny chevrons sitting just before Review, Run, and the corner before Watch,
 * pointing in the clockwise travel direction. Static (the comet carries the
 * motion). They make travel direction legible even when reduced-motion. */
function LiveArrows() {
  // Each entry: position + rotation (deg) so the arrow points along travel.
  const arrows = [
    { x: X1, y: CY - 4, rot: 90 }, // entering Review (moving down the right side)
    { x: CX + 4, y: Y1, rot: 180 }, // entering Run (moving left along the bottom)
  ];
  return (
    <g>
      {arrows.map((a, i) => (
        <path
          key={i}
          d="M -6 -5 L 4 0 L -6 5"
          fill="none"
          stroke={MINT}
          strokeOpacity={0.75}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`translate(${a.x} ${a.y}) rotate(${a.rot})`}
        />
      ))}
    </g>
  );
}

/* ── Feedback edge: Watch → Author closes the loop ──────────────────────
 * The left-then-top inner run from the Watch node up and across to Author,
 * drawn as a dashed muted path with an arrowhead INTO Author and a label.
 * This is the "loop closes" cue — monitoring / self-heal feeds the next
 * authoring pass. It traces the same corner as the base track (left + top
 * sides) but is rendered distinctly so it doesn't read as just more track. */
function FeedbackEdge({ animate }: { animate: boolean }) {
  // Path from Watch (left-centre) up the left side, around the top-left corner,
  // and along the top to just short of the Author node — arrowhead lands there.
  const d = [
    `M ${X0} ${CY}`,
    `L ${X0} ${Y0 + R}`,
    `A ${R} ${R} 0 0 1 ${X0 + R} ${Y0}`,
    `L ${CX - 64} ${Y0}`,
  ].join(' ');

  // Label sits in the top-left inner corner, away from the track.
  const lx = X0 + 30;
  const ly = Y0 + 30;

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={MUTE}
        strokeOpacity={0.85}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="6 5"
        markerEnd="url(#loop-arrow-dim)"
        style={
          animate
            ? { animation: 'loop-feedback-dash 0.9s linear infinite' }
            : undefined
        }
      />
      {/* "feedback" chip */}
      <g transform={`translate(${lx} ${ly}) rotate(45)`}>
        <rect
          x={-34}
          y={-9}
          width={68}
          height={18}
          rx={5}
          fill={BG3}
          stroke={MUTE}
          strokeOpacity={0.45}
          strokeWidth={0.75}
        />
        <text
          x={0}
          y={3.5}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fill={MUTE}
          letterSpacing={0.4}
        >
          self-heal ↩
        </text>
      </g>
    </g>
  );
}
