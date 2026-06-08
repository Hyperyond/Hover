export type Verdict = 'pass' | 'downgrade' | 'kill' | 'chain';

/** Patterns never worth a regression spec on your own dev app — noise the gate
 *  suppresses (adapted from Claude-BugHunter's never-submit list). */
export const NEVER_SUBMIT = [
  'self-xss', 'missing security header',
  'clickjacking', 'logout csrf', 'csrf on logout',
  'rate limit only', 'rate-limit only',
];

export interface FindingSignals {
  /** Class or free-text title, e.g. "IDOR on /api/orders". */
  title: string;
  /** Reproducible right now with a real request? */
  exploitableNow: boolean;
  /** Impact demonstrated (not merely "technically possible")? */
  impactProven: boolean;
  /** Already-known / documented / intended behavior? */
  alreadyKnown: boolean;
  /** Only exploitable when chained with another finding? */
  needsChain?: boolean;
}

export interface GateResult {
  verdict: Verdict;
  reasons: string[];
}

/**
 * Decide whether a finding becomes a `.security.spec.ts` regression test.
 * Adapted from Claude-BugHunter's 7-Question Gate, dropping the bug-bounty
 * questions (program scope / accepted-impact list). Deterministic.
 */
export function gateFinding(f: FindingSignals): GateResult {
  const title = f.title.toLowerCase();
  if (NEVER_SUBMIT.some(p => title.includes(p))) {
    return { verdict: 'kill', reasons: ['matches the never-submit suppression list'] };
  }
  if (!f.exploitableNow) {
    return { verdict: 'kill', reasons: ['not reproducible with a real request right now'] };
  }
  if (f.needsChain) {
    return { verdict: 'chain', reasons: ['only exploitable when chained with another finding'] };
  }
  const reasons: string[] = [];
  if (!f.impactProven) reasons.push('impact not yet proven beyond "technically possible"');
  if (f.alreadyKnown) reasons.push('already-known / intended behavior');
  if (reasons.length > 0) return { verdict: 'downgrade', reasons };
  return { verdict: 'pass', reasons: ['exploitable now, impact proven, not already-known'] };
}
