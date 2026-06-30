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
 * UP the left as the self-heal feedback edge (4 → 1) that closes the pipeline.
 * The owned artifact — `@playwright/test`, "you own it" — sits at the foot as
 * the through-line everything produces.
 *
 * ANIMATION — single source of truth. One rAF clock produces a normalized lap
 * progress; the comet head + trail (positioned along the real path via
 * getPointAtLength) AND the currently-lit stage are BOTH derived from it, so
 * they can never drift out of sync (the failure mode of two independent
 * timers). Same declarative spirit as the Business Map demo: one state, every
 * visual follows it.
 *
 * Gated with useInView (no rAF offscreen). prefers-reduced-motion → fully
 * static: the pipeline, all four nodes, the feedback edge, no motion.
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
const SPINE_LEN = BOTY - TOPY; // arc-length of the straight spine

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

const LAP_MS = 8200; // one full lap (down the spine + back up the feedback arc)
// Pace: give the four stages a generous share of the lap (spine), the self-heal
// return the rest. The comet eases through the stages, glides back up.
const SPINE_T = 0.62; // fraction of the lap spent descending the spine
const COMET = 8; // comet dots incl. head
const TRAIL_DT = 0.012; // time gap between trail dots (fraction of a lap)

// Centre of the owned-artifact badge at the foot.
const ARTY = BOTY + 96; // = 502

export function LoopDiagram() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  const [active, setActive] = useState<number | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dotsRef = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    if (!run) {
      setActive(null);
      return;
    }
    const path = pathRef.current;
    if (!path) return;
    const total = path.getTotalLength();
    const arcLen = total - SPINE_LEN;

    // Map a lap-time fraction (0..1) to an arc-distance along LOOP. Constant speed
    // within the spine and within the arc, but the spine gets SPINE_T of the lap.
    const distAt = (tf: number) => {
      const t = ((tf % 1) + 1) % 1;
      return t < SPINE_T
        ? (t / SPINE_T) * SPINE_LEN
        : SPINE_LEN + ((t - SPINE_T) / (1 - SPINE_T)) * arcLen;
    };

    // Which stage is "active" at lap-time tf — the one the comet is at / last passed.
    // On the spine each stage owns a third of SPINE_T; the arc's second half hands
    // back to Author (the self-heal feeding the next authoring pass).
    const activeAt = (tf: number) => {
      if (tf < SPINE_T / 3) return 0;
      if (tf < (SPINE_T * 2) / 3) return 1;
      if (tf < SPINE_T) return 2;
      if (tf < SPINE_T + (1 - SPINE_T) / 2) return 3;
      return 0;
    };

    let raf = 0;
    let start = -1;
    let last = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const tf = (((now - start) / LAP_MS) % 1 + 1) % 1;
      for (let j = 0; j < COMET; j++) {
        const pt = path.getPointAtLength(distAt(tf - j * TRAIL_DT));
        const c = dotsRef.current[j];
        if (c) {
          c.setAttribute('cx', String(pt.x));
          c.setAttribute('cy', String(pt.y));
        }
      }
      const a = activeAt(tf);
      if (a !== last) {
        last = a;
        setActive(a);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
          {/* Comet glow — a soft blur on the head so it reads as light, not a dot. */}
          <filter id="loop-comet-glow" x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="2.6" />
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
          @keyframes loop-feedback-dash { to { stroke-dashoffset: -14; } }
        `}</style>

        {/* Invisible reference copy of the loop — measured for getPointAtLength. */}
        <path ref={pathRef} d={LOOP} fill="none" stroke="none" />

        {/* Spine — Author → Watch, faint, sits behind nodes. */}
        <path d={SPINE} fill="none" stroke={LINE2} strokeWidth={2} strokeLinecap="round" />

        {/* Down chevrons in the gaps between stages — legible even under reduced motion. */}
        <DownChevrons />

        {/* The self-heal feedback edge (Watch → Author): dashed, muted, arrowhead
            into Author + a label. This is what makes the pipeline read as a loop. */}
        <FeedbackEdge animate={run} />

        {/* The comet — rAF-positioned head + fading trail. Drawn BEFORE the nodes so
            it pulses behind them (hidden under a node, visible in the gaps), then runs
            fully visible up the feedback arc. */}
        {run && (
          <g>
            {Array.from({ length: COMET }).map((_, j) => {
              const t = j / (COMET - 1); // 0 = head, 1 = tail
              const r = 4.6 - t * 3.2;
              const op = 0.95 - t * 0.82;
              return (
                <circle
                  key={j}
                  ref={(el) => {
                    dotsRef.current[j] = el;
                  }}
                  cx={NX}
                  cy={TOPY}
                  r={r}
                  fill={MINT}
                  fillOpacity={op}
                  filter={j === 0 ? 'url(#loop-comet-glow)' : undefined}
                />
              );
            })}
          </g>
        )}

        {/* ── Stage nodes (on top so the comet pulses behind them) ── */}
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

  const tween = reduced ? undefined : 'transform 320ms cubic-bezier(0.4,0,0.2,1)';
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
