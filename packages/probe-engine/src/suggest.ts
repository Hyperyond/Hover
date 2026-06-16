import type { ProbeFlow } from './types.js';
import type { SecurityClass, SecuritySeed, SeedCategory } from './seed.js';
import { matchSeeds } from './match.js';
import { builtinSecuritySeeds } from './builtins.js';

/** A captured flow that carries an id (e.g. @hover-dev/api-test's Flow). */
export interface IdentifiedFlow extends ProbeFlow {
  id: string;
}

/** A "this flow is worth probing for X" hint surfaced to the agent. */
export interface ProbeSuggestion {
  flowId: string;
  method: string;
  url: string;
  class: SecurityClass;
  /** Seed name the suggestion came from. */
  seed: string;
  /** How to probe it. */
  strategy: string;
  /** What a real finding looks like. */
  signal: string;
}

/**
 * Match captured flows against probe seeds and return per-flow suggestions —
 * the deterministic "what's worth probing" list the agent acts on. Pure.
 *
 * `opts.categories`, when given, gates seeds by their `category` (defaulting a
 * seed with no category to `authz`) so orange security mode and red pentest
 * mode can each draw their own slice of the seed set. Omitting it keeps ALL
 * seeds (back-compat).
 */
export function suggestProbes(
  flows: IdentifiedFlow[],
  seeds: SecuritySeed[] = builtinSecuritySeeds,
  opts: { categories?: SeedCategory[] } = {},
): ProbeSuggestion[] {
  const active = opts.categories
    ? seeds.filter(s => opts.categories!.includes(s.category ?? 'authz'))
    : seeds;
  return flows.flatMap(f =>
    matchSeeds(f, active).map(s => ({
      flowId: f.id,
      method: f.request.method,
      url: f.request.url,
      class: s.class,
      seed: s.name,
      strategy: s.probe.strategy,
      signal: s.probe.signal,
    })),
  );
}
