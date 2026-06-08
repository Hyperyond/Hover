import type { IdentifiedFlow } from './suggest.js';
import type { SecurityClass, SecuritySeed, SeedCategory } from './seed.js';
import { matchSeeds } from './match.js';
import { builtinSecuritySeeds } from './builtins.js';

/** One probe the sweep would run: a (flow, seed) pair with its risk flags. */
export interface SweepProbe {
  flowId: string;
  method: string;
  url: string;
  class: SecurityClass;
  seed: string;
  strategy: string;
  /** Issues a state-changing request (DELETE / mass-assign). */
  destructive: boolean;
  /** Needs a second identity (storageState) to be meaningful. */
  secondIdentity: boolean;
}

export interface SweepPlan {
  /** Probes safe to run under the current options. */
  probes: SweepProbe[];
  /** Probes held back — destructive ones when `allowDestructive` is off. */
  skipped: SweepProbe[];
}

export interface SweepOptions {
  /** Allow destructive probes (DELETE / state-changing mass-assign). Off by
   *  default — the engine enforces this, never the recipe. */
  allowDestructive?: boolean;
  seeds?: SecuritySeed[];
  /** Gate seeds by `category` (a seed with no category defaults to `authz`) so
   *  orange security mode and red pentest mode each draw their own slice.
   *  Omitting it keeps ALL seeds (back-compat). */
  categories?: SeedCategory[];
}

/**
 * Plan a broad sweep: every captured flow against every matching seed. The
 * destructive safety gate is enforced HERE — destructive probes go to
 * `skipped` unless `allowDestructive` is set, never silently run. Pure.
 */
export function planSweep(flows: IdentifiedFlow[], opts: SweepOptions = {}): SweepPlan {
  const all = opts.seeds ?? builtinSecuritySeeds;
  const seeds = opts.categories
    ? all.filter(s => opts.categories!.includes(s.category ?? 'authz'))
    : all;
  const probes: SweepProbe[] = [];
  const skipped: SweepProbe[] = [];
  for (const f of flows) {
    for (const s of matchSeeds(f, seeds)) {
      const probe: SweepProbe = {
        flowId: f.id,
        method: f.request.method,
        url: f.request.url,
        class: s.class,
        seed: s.name,
        strategy: s.probe.strategy,
        destructive: s.probe.destructive ?? false,
        secondIdentity: s.probe.secondIdentity ?? false,
      };
      if (probe.destructive && !opts.allowDestructive) skipped.push(probe);
      else probes.push(probe);
    }
  }
  return { probes, skipped };
}
