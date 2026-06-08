import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SecurityClass =
  // business / authorization (orange "security mode")
  | 'idor' | 'bola' | 'bfla' | 'mass-assignment' | 'auth-bypass'
  // vulnerability / attack (red "pentest mode")
  | 'ssrf' | 'open-redirect' | 'path-traversal' | 'cors' | 'jwt'
  | 'sqli' | 'xss' | 'ssti' | 'xxe' | 'deserialization' | 'rce' | 'csrf' | 'graphql';

/** Which mode a seed belongs to: `authz` (business/access-control, security
 *  mode) or `vuln` (attack/exploit, pentest mode). Defaults to authz when
 *  absent. */
export type SeedCategory = 'authz' | 'vuln';

export interface SecuritySeed {
  name: string;
  class: SecurityClass;
  /** authz (security mode) vs vuln (pentest mode). */
  category?: SeedCategory;
  note?: string;
  match: { method?: string[]; urlParam?: string; bodyField?: string; needsAuth?: boolean };
  probe: { strategy: string; secondIdentity?: boolean; destructive?: boolean; signal: string };
}

/** A security seed is distinguished from an optimization seed by its `probe`
 *  block (optimization seeds have `signature` + `example` instead). */
export function isSecuritySeed(o: unknown): o is SecuritySeed {
  if (!o || typeof o !== 'object') return false;
  const s = o as Record<string, unknown>;
  const match = s.match as Record<string, unknown> | undefined;
  const probe = s.probe as Record<string, unknown> | undefined;
  if (typeof s.name !== 'string' || typeof s.class !== 'string') return false;
  if (typeof match !== 'object' || match === null) return false;
  // `method`, if present, MUST be an array — otherwise matchesFlow's `.map()`
  // would throw on a malformed seed (untrusted input must never crash matching).
  if (match.method !== undefined && !Array.isArray(match.method)) return false;
  if (typeof probe !== 'object' || probe === null) return false;
  // Both `strategy` and `signal` are required by the type — validate both so a
  // seed missing `signal` can't pass the guard and surprise downstream readers.
  if (typeof probe.strategy !== 'string' || typeof probe.signal !== 'string') return false;
  return true;
}

/** Load security-probe seeds from `<devRoot>/.hover/rules/` (flat) and its
 *  `security/` subdir. Optimization seeds in the same tree are skipped. */
export async function loadSecuritySeeds(devRoot: string): Promise<SecuritySeed[]> {
  const root = join(devRoot, '.hover', 'rules');
  const collected: SecuritySeed[] = [];
  await collect(root, collected);
  await collect(join(root, 'security'), collected);
  // A seed can land in both rules/ and rules/security/ (copy or symlink) —
  // keep the first per name so one flow never gets probed twice by it.
  const seen = new Set<string>();
  return collected.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}

async function collect(dir: string, out: SecuritySeed[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(dir, entry), 'utf-8'));
      if (isSecuritySeed(parsed)) out.push(parsed);
    } catch {
      /* skip malformed */
    }
  }
}
