import type { ProbeFlow } from './types.js';
import type { SecuritySeed } from './seed.js';

/** Case-insensitive header lookup — matches regardless of how the captured
 *  header key was cased (`Cookie` vs `cookie`). */
function header(flow: ProbeFlow, name: string): string | string[] | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(flow.request.headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

/** Does this captured flow carry an auth credential? */
export function hasAuth(flow: ProbeFlow): boolean {
  return Boolean(header(flow, 'cookie') || header(flow, 'authorization') || header(flow, 'x-api-key'));
}

/** Compile + test a seed-supplied (untrusted) regex; a bad pattern never throws. */
function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

/** Evaluate a seed's `match` block against a captured flow. Cheap relevance
 *  filter — never an exact match. */
export function matchesFlow(seed: SecuritySeed, flow: ProbeFlow): boolean {
  const m = seed.match;
  // Array.isArray guard: a malformed seed (method as a bare string) must skip
  // the method filter, never throw on `.map()`.
  if (Array.isArray(m.method) && m.method.length > 0) {
    const want = m.method.map(x => String(x).toUpperCase());
    if (!want.includes(flow.request.method.toUpperCase())) return false;
  }
  if (m.urlParam && !safeTest(m.urlParam, flow.request.url)) return false;
  if (m.bodyField && !safeTest(m.bodyField, flow.request.bodyText ?? '')) return false;
  if (m.needsAuth && !hasAuth(flow)) return false;
  return true;
}

/** All seeds relevant to a flow — the "what to probe" list. */
export function matchSeeds(flow: ProbeFlow, seeds: SecuritySeed[]): SecuritySeed[] {
  return seeds.filter(s => matchesFlow(s, flow));
}
