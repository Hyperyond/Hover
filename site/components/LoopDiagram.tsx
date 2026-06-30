'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * The hero-right visual: Hover's lifecycle as a VERTICAL closed pipeline.
 *
 *   1 Author · MCP
 *   2 Review · VS Code
 *   3 Run · CI
 *   4 Watch · Cloud  ──self-heal──▶ back to 1 Author
 *
 * Four stage nodes stack top-to-bottom. A mint comet flows DOWN the central
 * spine through the stages (visible in the gaps between nodes), then loops back
 * UP the left side — the self-heal feedback edge from Watch (4) to Author (1)
 * that closes the pipeline. As the comet passes a stage, that stage lights up
 * in sequence. The owned artifact — `@playwright/test`, "you own it" — sits at
 * the foot as the through-line everything produces.
 *
 * Pure SVG + CSS. Gated with useInView (no work offscreen). prefers-reduced-
 * motion → fully static: the pipeline, all four nodes, the feedback edge, no
 * motion.
 */

const MINT = '#7CFFA8';
const BG2 = '#222224';
const BG3 = '#141414';
const LINE = '#2a2a2c';
const LINE2 = '#3a3a3c';
const TEXT = '#e5e7eb';
const MUTE = '#9ca3af';
const DIM = '#6b7280';

// Portrait viewBox — taller than wide for a vertical pipeline.
const VBW = 440;
const VBH = 580;

const NX = VBW / 2; // node column centre (the spine)
const NW = 178; // node width
const NH = 58; // node height

// Four stages stacked vertically, evenly spaced.
const TOPY = 70; // centre of node 1 (Author)
const GAP = 112; // centre-to-centre spacing
const BOTY = TOPY + GAP * 3; // centre of node 4 (Watch) = 406

type StageDef = {
  k: string;
  stage: string;
  surface: string;
  n: number; // step number
  planned?: boolean;
  ny: number; // node centre y (all share x = NX)
};

const STAGES: StageDef[] = [
  { k: 'author', stage: 'Author', surface: 'MCP', n: 1, ny: TOPY },
  { k: 'review', stage: 'Review', surface: 'VS Code', n: 2, ny: TOPY + GAP },
  { k: 'run', stage: 'Run', surface: 'CI', n: 3, ny: TOPY + GAP * 2 },
  { k: 'watch', stage: 'Watch', surface: 'Cloud', n: 4, planned: true, ny: BOTY },
];

// The central spine the comet flows down (Author → Watch), drawn faint and sitting
// behind the nodes so the comet reads as a pulse moving between stages.
const SPINE = `M ${NX} ${TOPY} L ${NX} ${BOTY}`;

// The self-heal feedback edge: from Watch (4) back up to Author (1), bulging out
// to the left as a smooth arc. Both endpoints tuck behind their nodes.
const FEEDBACK = `M ${NX} ${BOTY} C 52 ${BOTY} 52 ${TOPY} ${NX} ${TOPY}`;

// The full closed loop the comet travels: down the spine, then up the feedback arc.
const LOOP = `M ${NX} ${TOPY} L ${NX} ${BOTY} C 52 ${BOTY} 52 ${TOPY} ${NX} ${TOPY}`;

const LAP_MS = 8000; // one full lap (down the spine + back up the feedback arc)

// Centre of the owned-artifact badge at the foot.
const ARTY = BOTY + 96; // = 502

export function LoopDiagram() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  // Which node is currently "active" (lit). Driven by a JS interval that steps
  // in lockstep with the comet (one stage per quarter-lap). When not running we
  // leave it null so the static fallback shows the calm pipeline fully drawn.
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!run) {
      setActive(null);
      return;
    }
    const step = LAP_MS / STAGES.length;
    setActive(0);
    const id = setInterval(() => {
      setActive((a) => ((a ?? 0) + 1) % STAGES.length);
    }, step);
    return () => clearInterval(id);
  }, [run]);

  return (
    <div ref={rootRef} className="select-none" style={{ width: '100%', maxWidth: 400 }}>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        width="100%"
        role="img"
        aria-label="Hover's closed lifecycle pipeline: 1 Author (MCP), 2 Review (VS Code), 3 Run (CI), 4 Watch (Cloud, planned), with a self-heal feedback edge from Watch back to Author. The stages produce the @playwright/test suite you own, shown at the foot."
        style={{ display: 'block' }}
      >
        <defs>
          {/* Comet glow — a soft blur so the moving head reads as light, not a hard
              dash. Applied to the halo layer; the crisp head sits on top. We
              deliberately do NOT colour the comet with a spatial gradient: an SVG
              stroke gradient paints by bbox position, so a moving dash goes invisible
              on whichever leg falls at the transparent end. */}
          <filter id="loop-comet-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <radialGradient id="loop-center-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(124,255,168,0.16)" />
            <stop offset="100%" stopColor="rgba(124,255,168,0)" />
          </radialGradient>
          {/* Dim arrowhead for the feedback edge into Author. */}
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

        {/* ── Tracks ───────────────────────────────────────────────────────
            faint central spine (behind the nodes) + the dashed self-heal
            feedback arc that closes the loop. */}

        {/* Spine — Author → Watch, faint, sits behind nodes. */}
        <path d={SPINE} fill="none" stroke={LINE2} strokeWidth={2} strokeLinecap="round" />

        {/* Down chevrons in the gaps between stages — make the downward travel
            legible even under reduced motion. */}
        <DownChevrons />

        {/* The self-heal feedback edge (Watch → Author): dashed, muted, with an
            arrowhead into Author and a label. This is what makes the pipeline
            read as a closed loop. */}
        <FeedbackEdge animate={run} />

        {/* ── The comet — a soft mint light running down the spine and back up the
            feedback arc, forever. Two layers: a wide blurred halo (tail) trailing a
            crisp head. Solid mint (no spatial gradient) → uniformly visible on the
            spine AND the feedback arc, so the 4→1 leg animates too. */}
        {run && (
          <g>
            <path
              d={LOOP}
              fill="none"
              stroke={MINT}
              strokeOpacity={0.4}
              strokeWidth={7}
              strokeLinecap="round"
              pathLength={1000}
              filter="url(#loop-comet-glow)"
              style={
                {
                  strokeDasharray: '110 890',
                  ['--loop-len' as string]: '-1000',
                  animation: `loop-comet-run ${LAP_MS}ms linear infinite`,
                } as React.CSSProperties
              }
            />
            <path
              d={LOOP}
              fill="none"
              stroke={MINT}
              strokeOpacity={0.95}
              strokeWidth={3}
              strokeLinecap="round"
              pathLength={1000}
              style={
                {
                  strokeDasharray: '52 948',
                  ['--loop-len' as string]: '-1000',
                  animation: `loop-comet-run ${LAP_MS}ms linear infinite`,
                } as React.CSSProperties
              }
            />
          </g>
        )}

        {/* ── Stage nodes (drawn on top so the comet pulses behind them) ── */}
        {STAGES.map((s, i) => (
          <StageNode key={s.k} s={s} lit={active === i} reduced={reduced} />
        ))}

        {/* ── The owned artifact at the foot — the through-line you keep ── */}
        <ArtifactBadge />
      </svg>
    </div>
  );
}

/* ── The owned @playwright/test artifact — foot of the pipeline ─────────── */
function ArtifactBadge() {
  return (
    <g>
      <circle cx={NX} cy={ARTY} r={96} fill="url(#loop-center-glow)" />
      <text
        x={NX}
        y={ARTY - 20}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize={10}
        fill={DIM}
        letterSpacing={1.5}
      >
        YOUR SUITE
      </text>
      <text
        x={NX}
        y={ARTY + 3}
        textAnchor="middle"
        fontFamily="ui-monospace, monospace"
        fontSize={16}
        fontWeight={600}
        fill={MINT}
      >
        @playwright/test
      </text>
      <text
        x={NX}
        y={ARTY + 24}
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

/* ── A stage node — pill card centred on the spine at (NX, ny) ──────────── */
function StageNode({
  s,
  lit,
  reduced,
}: {
  s: StageDef;
  lit: boolean;
  reduced: boolean;
}) {
  const x = NX - NW / 2;
  const y = s.ny - NH / 2;

  const accent = s.planned ? MUTE : MINT;
  const stroke = lit ? accent : s.planned ? LINE2 : LINE;
  const strokeOpacity = lit ? 1 : s.planned ? 0.9 : 1;
  const fill = lit
    ? s.planned
      ? 'rgba(156,163,175,0.07)'
      : 'rgba(124,255,168,0.10)'
    : BG2;

  const tween = reduced ? undefined : 'transform 360ms cubic-bezier(0.4,0,0.2,1)';
  const scale = lit ? 1.05 : 1;

  return (
    <g
      style={{
        transform: `translate(${NX}px, ${s.ny}px) scale(${scale}) translate(${-NX}px, ${-s.ny}px)`,
        transition: tween,
      }}
    >
      {/* lit glow ring */}
      {lit && !s.planned && (
        <rect
          x={x - 4}
          y={y - 4}
          width={NW + 8}
          height={NH + 8}
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
        width={NW}
        height={NH}
        rx={11}
        fill={fill}
        stroke={stroke}
        strokeOpacity={strokeOpacity}
        strokeWidth={lit && !s.planned ? 1.75 : 1.25}
        strokeDasharray={s.planned ? '4 3' : undefined}
      />
      {/* step number badge */}
      <circle
        cx={x + 18}
        cy={y + 18}
        r={9}
        fill={BG3}
        stroke={lit ? accent : LINE2}
        strokeWidth={1.25}
      />
      <text
        x={x + 18}
        y={y + 21.5}
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
        x={x + 36}
        y={y + 23}
        textAnchor="start"
        fontFamily="ui-monospace, monospace"
        fontSize={14}
        fontWeight={600}
        fill={lit ? (s.planned ? TEXT : MINT) : TEXT}
      >
        {s.stage}
      </text>
      {/* surface sub-label */}
      <text
        x={x + 16}
        y={y + 43}
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

/* ── Down chevrons in the gaps between stages ───────────────────────────── */
function DownChevrons() {
  // Sit at the midpoints between consecutive node centres, on the spine.
  const ys = [TOPY + GAP / 2, TOPY + GAP * 1.5, TOPY + GAP * 2.5];
  return (
    <g>
      {ys.map((cy, i) => (
        <path
          key={i}
          d="M -6 -4 L 0 4 L 6 -4"
          fill="none"
          stroke={MINT}
          strokeOpacity={0.6}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`translate(${NX} ${cy})`}
        />
      ))}
    </g>
  );
}

/* ── Feedback edge: Watch (4) → Author (1) closes the loop ──────────────── */
function FeedbackEdge({ animate }: { animate: boolean }) {
  // Label sits on the bulge of the arc, mid-height, on the left.
  const lx = 86;
  const ly = (TOPY + BOTY) / 2;

  return (
    <g>
      <path
        d={FEEDBACK}
        fill="none"
        stroke={MUTE}
        strokeOpacity={0.85}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="6 5"
        markerEnd="url(#loop-arrow-dim)"
        style={
          animate ? { animation: 'loop-feedback-dash 0.9s linear infinite' } : undefined
        }
      />
      {/* "self-heal" chip riding the arc */}
      <g transform={`translate(${lx} ${ly})`}>
        <rect
          x={-36}
          y={-9}
          width={72}
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
