/**
 * QA run intensity presets — how hard a QA exploration tries, bounded by a hard
 * model-spend ceiling so "explore the whole app" can't run away on cost/time.
 *
 * Each preset maps to a `maxBudgetUsd` (the agent CLI enforces it — claude via
 * `--max-budget-usd`) AND drives a prompt directive (qaBudgetDirective) telling
 * the agent its budget so it PACES itself and writes the findings report before
 * the ceiling instead of being hard-cut mid-action. The $ ceiling is the
 * backstop; the prose is what guarantees a report (and works for agents without
 * a budget flag). Only applies in QA mode.
 */
export type QaIntensity = 'quick' | 'standard' | 'deep';

export interface QaIntensitySpec {
  label: string;
  /** Hard model-spend ceiling for the run (USD). */
  maxBudgetUsd: number;
  /** One-line description of how far to go — used in the prompt + the UI. */
  blurb: string;
}

export const QA_INTENSITY: Record<QaIntensity, QaIntensitySpec> = {
  quick: { label: 'Quick', maxBudgetUsd: 0.25, blurb: 'a fast pass over the main flows — breadth over depth' },
  standard: { label: 'Standard', maxBudgetUsd: 0.6, blurb: 'the main flows plus key negative tests' },
  deep: { label: 'Deep', maxBudgetUsd: 1.5, blurb: 'exhaustive — every reachable control and state' },
};

export const DEFAULT_QA_INTENSITY: QaIntensity = 'standard';

/** Coerce arbitrary input (from the run payload) to a valid intensity. */
export function asQaIntensity(v: unknown): QaIntensity {
  return v === 'quick' || v === 'deep' || v === 'standard' ? v : DEFAULT_QA_INTENSITY;
}

/**
 * Prompt directive: tell the agent its run budget so it paces and ALWAYS wraps
 * up with a report. The numeric ceiling is enforced by the CLI; this prose makes
 * the agent prioritise and guarantees the report regardless of the agent.
 */
export function qaBudgetDirective(intensity: QaIntensity): string {
  const spec = QA_INTENSITY[intensity];
  return (
    `RUN BUDGET — ${spec.label}: ${spec.blurb}. You have a LIMITED budget this run ` +
    `(about $${spec.maxBudgetUsd.toFixed(2)} of model spend, enforced). Pace yourself ` +
    `to fit it: cover the most important flows FIRST. When you sense you are nearing ` +
    `the budget, STOP exploring and immediately WRITE YOUR FINDINGS REPORT (and record ` +
    `any clean candidate flows) while you still can — never end a run without a report. ` +
    `On Quick, be decisive and favour breadth; on Deep, be exhaustive.`
  );
}
