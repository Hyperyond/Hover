import { writeSpec, type SkillStep, type WriteSpecResult } from '@hover-dev/core/engine';

/* Turn a captured candidate flow into a plain Playwright spec via core's
 * deterministic `writeSpec` (no LLM, no agent FS access). The candidate's steps
 * are the grounded actions the control server buffered during exploration, so
 * the saved selectors are the ones that drove the run — record==replay. */

export interface CandidateInput {
  name: string;
  description?: string;
  steps: SkillStep[];
}

/** Injectable for tests — defaults to core's real writeSpec. */
export type WriteSpecFn = typeof writeSpec;

export async function crystallizeCandidate(
  opts: { devRoot: string; target: string; candidate: CandidateInput; overwrite?: boolean },
  write: WriteSpecFn = writeSpec,
): Promise<WriteSpecResult> {
  return write({
    devRoot: opts.devRoot,
    name: opts.candidate.name,
    description: opts.candidate.description,
    steps: opts.candidate.steps,
    startUrl: opts.target,
    overwrite: opts.overwrite ?? true,
  });
}
