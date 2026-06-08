import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SecurityClass =
  | 'idor' | 'bola' | 'bfla' | 'mass-assignment' | 'ssrf'
  | 'auth-bypass' | 'open-redirect' | 'path-traversal' | 'cors' | 'jwt';

export interface SecuritySeed {
  name: string;
  class: SecurityClass;
  note?: string;
  match: { method?: string[]; urlParam?: string; bodyField?: string; needsAuth?: boolean };
  probe: { strategy: string; secondIdentity?: boolean; destructive?: boolean; signal: string };
  assert?: string;
}

/** A security seed is distinguished from an optimization seed by its `probe`
 *  block (optimization seeds have `signature` + `example` instead). */
export function isSecuritySeed(o: unknown): o is SecuritySeed {
  if (!o || typeof o !== 'object') return false;
  const s = o as Record<string, unknown>;
  const probe = s.probe as Record<string, unknown> | undefined;
  return typeof s.name === 'string'
    && typeof s.class === 'string'
    && typeof s.match === 'object' && s.match !== null
    && typeof probe === 'object' && probe !== null
    && typeof probe.strategy === 'string';
}

/** Load security-probe seeds from `<devRoot>/.hover/rules/` (flat) and its
 *  `security/` subdir. Optimization seeds in the same tree are skipped. */
export async function loadSecuritySeeds(devRoot: string): Promise<SecuritySeed[]> {
  const root = join(devRoot, '.hover', 'rules');
  const out: SecuritySeed[] = [];
  await collect(root, out);
  await collect(join(root, 'security'), out);
  return out;
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
