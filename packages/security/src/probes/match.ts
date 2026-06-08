import type { Flow } from '../mitm/flows.js';
import type { SecuritySeed } from './seed.js';

/** Header lookup that tolerates any-case keys. */
function header(flow: Flow, name: string): string | string[] | undefined {
  const h = flow.request.headers;
  return h[name] ?? h[name.toLowerCase()];
}

/** Does this captured flow carry an auth credential? */
export function hasAuth(flow: Flow): boolean {
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
export function matchesFlow(seed: SecuritySeed, flow: Flow): boolean {
  const m = seed.match;
  if (m.method && m.method.length > 0) {
    const want = m.method.map(x => x.toUpperCase());
    if (!want.includes(flow.request.method.toUpperCase())) return false;
  }
  if (m.urlParam && !safeTest(m.urlParam, flow.request.url)) return false;
  if (m.bodyField && !safeTest(m.bodyField, flow.request.bodyText ?? '')) return false;
  if (m.needsAuth && !hasAuth(flow)) return false;
  return true;
}

/** All seeds relevant to a flow — the "what to probe" list. */
export function matchSeeds(flow: Flow, seeds: SecuritySeed[]): SecuritySeed[] {
  return seeds.filter(s => matchesFlow(s, flow));
}
