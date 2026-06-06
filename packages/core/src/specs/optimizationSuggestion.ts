/**
 * The default-off "should we nudge the user to optimize this spec?" signal
 * (F7 / D10). Optimization never runs automatically; instead, when a saved spec
 * has a clear improvable shape, the widget surfaces a "review optimization?"
 * prompt. This computes that decision + human-readable reasons.
 *
 * Pure function so it's trivially testable; `listSpecs` gathers the inputs
 * (optimizable-marker count, sidecar presence, relevant seed names) and attaches
 * the result to each SpecSummary.
 */

export interface OptimizationSuggestion {
  /** Whether to nudge the user to run the optimization pass on this spec. */
  suggested: boolean;
  /** Human-readable reasons, for the widget tooltip / prompt. Empty when not
   *  suggested. */
  reasons: string[];
}

export function optimizationSuggestion(args: {
  /** Whether a `.hover/<slug>.json` sidecar exists. */
  hasSidecar: boolean;
  /** Count of `// hover:optimizable` markers in the spec. */
  optimizableCount: number;
  /** Names of seeds whose signature is relevant to this spec's tools. */
  relevantSeedNames: string[];
}): OptimizationSuggestion {
  const { hasSidecar, optimizableCount, relevantSeedNames } = args;
  const reasons: string[] = [];

  // The optimization pass reads the sidecar (observed feedback, captured steps);
  // without one there's nothing to optimize from. Matches the widget's Optimize
  // gate, so we never suggest what can't be acted on.
  if (!hasSidecar) return { suggested: false, reasons };

  if (optimizableCount > 0) {
    const n = optimizableCount;
    reasons.push(
      `${n} interaction${n === 1 ? '' : 's'} couldn't be fully translated — the optimization pass can complete ${n === 1 ? 'it' : 'them'}`,
    );
  }
  if (relevantSeedNames.length > 0) {
    const k = relevantSeedNames.length;
    reasons.push(`${k} seed${k === 1 ? '' : 's'} may apply: ${relevantSeedNames.join(', ')}`);
  }

  return { suggested: reasons.length > 0, reasons };
}
