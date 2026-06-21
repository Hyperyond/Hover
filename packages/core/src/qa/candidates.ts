/**
 * QA candidate-flow finalization.
 *
 * During a QA run the agent calls `record_candidate(name)` right after it
 * completes a coherent flow; the hover-control MCP captures the actual grounded
 * actuation steps since the previous marker and sends them along — so a
 * candidate already carries its real, replayable SkillSteps (no fragile
 * step-number citing). This module just validates + de-dupes them before they
 * become one-click "Crystallize" cards.
 *
 * Pure + side-effect-free so it can be unit-tested without a live run.
 */
import type { SkillStep } from '../specs/specStep.js';

/** What the agent recorded: a flow name + the real steps Hover captured for it. */
export interface RecordedCandidate {
  name: string;
  description?: string;
  steps: SkillStep[];
}

/** A candidate ready to crystallize. */
export interface ResolvedCandidate {
  name: string;
  description?: string;
  steps: SkillStep[];
  stepCount: number;
}

/**
 * Validate + de-dupe recorded candidates: drop ones with no name or no steps,
 * collapse identical repeats (same name + same step count), and stamp stepCount.
 */
export function finalizeCandidates(candidates: readonly RecordedCandidate[]): ResolvedCandidate[] {
  const out: ResolvedCandidate[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const name = c.name?.trim();
    const steps = Array.isArray(c.steps) ? c.steps.filter((s) => s && s.kind === 'step') : [];
    if (!name || !steps.length) continue;
    const key = `${name}|${steps.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, description: c.description?.trim() || undefined, steps, stepCount: steps.length });
  }
  return out;
}
