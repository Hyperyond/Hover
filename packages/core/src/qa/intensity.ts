/**
 * QA run intensity presets — how hard a QA exploration tries, bounded by a hard
 * STEP ceiling so "explore the whole app" can't run away on time/cost.
 *
 * Each preset maps to a `maxSteps` (agent turns ≈ steps). It's enforced two ways:
 *   1. the prompt (qaBudgetDirective) tells the agent its step budget so it paces
 *      itself and writes the findings report BEFORE running out — the graceful
 *      path, and it works for every agent;
 *   2. a hard `--max-turns` backstop (claude) so a misbehaving agent is still
 *      bounded. Steps are what the user reasons in, so the budget is in steps,
 *      not dollars.
 * Only applies in QA mode.
 */
export type QaIntensity = 'quick' | 'standard' | 'deep';

export interface QaIntensitySpec {
  label: string;
  /** Hard ceiling on agent turns (~steps): the prompt paces against it and
   *  `--max-turns` enforces it as a backstop. */
  maxSteps: number;
  /** One-line description (with the rough step range) — used in the prompt + UI. */
  blurb: string;
}

export const QA_INTENSITY: Record<QaIntensity, QaIntensitySpec> = {
  quick: { label: 'Quick', maxSteps: 45, blurb: 'a fast pass over the main flows — breadth over depth (~20–45 steps)' },
  standard: { label: 'Standard', maxSteps: 150, blurb: 'the main flows plus key negative tests (~45–150 steps)' },
  deep: { label: 'Deep', maxSteps: 500, blurb: 'exhaustive — every reachable control and state (~150–500 steps)' },
};

export const DEFAULT_QA_INTENSITY: QaIntensity = 'standard';

/** Coerce arbitrary input (from the run payload) to a valid intensity. */
export function asQaIntensity(v: unknown): QaIntensity {
  return v === 'quick' || v === 'deep' || v === 'standard' ? v : DEFAULT_QA_INTENSITY;
}

/**
 * Prompt directive: tell the agent its STEP budget so it paces and ALWAYS wraps
 * up with a report before the ceiling. The `--max-turns` backstop is the hard
 * limit; this prose is what guarantees a report.
 */
export function qaBudgetDirective(intensity: QaIntensity): string {
  const spec = QA_INTENSITY[intensity];
  const wrapAt = Math.max(5, spec.maxSteps - Math.ceil(spec.maxSteps * 0.1));
  return (
    `RUN BUDGET — ${spec.label}: ${spec.blurb}. You have about ${spec.maxSteps} steps ` +
    `(tool actions) this run, enforced. Pace yourself to fit: cover the most ` +
    `important flows FIRST. By roughly step ${wrapAt}, STOP exploring and ` +
    `immediately WRITE YOUR FINDINGS REPORT (and record any clean candidate flows) ` +
    `while you still can — never end a run without a report. On Quick, be decisive ` +
    `and favour breadth; on Deep, be exhaustive.`
  );
}
