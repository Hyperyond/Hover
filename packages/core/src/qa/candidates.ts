/**
 * QA candidate-flow resolution.
 *
 * During a QA run the agent calls `record_candidate(name, steps)` when it
 * completes a coherent flow; `steps` are 1-based step numbers over the run's
 * actuation steps (the "· step N" tags echoed by actuateServer). At run end the
 * service resolves each candidate's numbers back to the ACTUAL recorded steps so
 * a one-click crystallize produces a record==replay Playwright spec — never the
 * agent's re-described selectors.
 *
 * Pure + side-effect-free so it can be unit-tested without a live run.
 */
import type { SkillStep } from '../specs/specStep.js';
import { isActuationStep } from '../mcp/actuationTools.js';

/** What the agent recorded: a flow name + the actuation step numbers (1-based). */
export interface RecordedCandidate {
  name: string;
  description?: string;
  steps: number[];
}

/** A candidate resolved to its real recorded steps, ready to crystallize. */
export interface ResolvedCandidate {
  name: string;
  description?: string;
  /** The actual recorded SkillSteps, in flow order — passed straight to writeSpec. */
  steps: SkillStep[];
  stepCount: number;
}

/**
 * Map each recorded candidate's step numbers to the run's recorded actuation
 * steps. The Nth actuation step (over `ACTUATION_TOOLS`, in order) is step N —
 * the same numbering actuateServer echoed to the agent. Out-of-range numbers are
 * dropped; a candidate that resolves to no steps, or has no name, is dropped;
 * identical candidates (same name + step set) are de-duped.
 */
export function resolveCandidates(
  allSteps: readonly SkillStep[],
  candidates: readonly RecordedCandidate[],
): ResolvedCandidate[] {
  const actuation = allSteps.filter((s) => s.kind === 'step' && isActuationStep(s.tool));
  const out: ResolvedCandidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const name = c.name?.trim();
    if (!name || !Array.isArray(c.steps)) continue;
    const nums = c.steps.filter((n) => Number.isInteger(n) && n > 0);
    const picked = nums.map((n) => actuation[n - 1]).filter((s): s is SkillStep => Boolean(s));
    if (!picked.length) continue;
    const key = `${name}|${nums.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, description: c.description?.trim() || undefined, steps: picked, stepCount: picked.length });
  }
  return out;
}
