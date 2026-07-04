/**
 * Keep the repo's `.gitignore` correct for Hover's knowledge base: commit the
 * durable knowledge (`.hover/hover-map.md`, `.hover/memory/`, `.hover/log.md`)
 * while ignoring the working files (`sidecars/`, `runs/`, `cache/`, `.env`).
 *
 * Called best-effort whenever Hover writes knowledge (memory / map). Idempotent
 * via a sentinel line; a failure NEVER breaks a run (same rule as the ledger).
 *
 * The git gotcha this navigates: a bare `.hover` ignore makes git skip the
 * whole directory, so `!.hover/memory/` can't re-include a subdir and a nested
 * `.hover/.gitignore` is never read. The only pattern that works is `.hover/*`
 * (single-level contents) + `!` exceptions — so we REWRITE any bare `.hover` /
 * `.hover/` line the user has into that form, then append our managed block.
 *
 * Opt out with HOVER_NO_GITIGNORE=1 (or a truthy value).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SENTINEL = '# Hover — knowledge base (managed)';

const BLOCK = [
  SENTINEL,
  '# Committed: the map, learned business rules, and the run log.',
  '# Ignored: sidecars, runs, cache, and .env (working files).',
  '.hover/*',
  '!.hover/hover-map.md',
  '!.hover/log.md',
  '!.hover/memory/',
  '',
].join('\n');

/** A line that blanket-ignores the whole `.hover` dir (the harmful pattern). */
function isBareHoverIgnore(line: string): boolean {
  const t = line.trim();
  return t === '.hover' || t === '.hover/' || t === '/.hover' || t === '/.hover/';
}

export type EnsureResult =
  | { changed: true; created: boolean }
  | { changed: false; reason: 'present' | 'disabled' | 'error' };

/**
 * Ensure `<devRoot>/.gitignore` tracks the knowledge base. Returns what it did
 * (for logging); never throws.
 */
export async function ensureKnowledgeTracked(
  devRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EnsureResult> {
  if (env.HOVER_NO_GITIGNORE) return { changed: false, reason: 'disabled' };
  const path = join(devRoot, '.gitignore');
  try {
    let existing = '';
    let created = false;
    try {
      existing = await readFile(path, 'utf-8');
    } catch {
      created = true; // no .gitignore yet
    }
    if (existing.includes(SENTINEL)) return { changed: false, reason: 'present' };

    // Drop any bare `.hover` blanket-ignore (it would defeat the re-includes).
    const kept = existing
      .split('\n')
      .filter((l) => !isBareHoverIgnore(l));

    const base = kept.join('\n').replace(/\n+$/, '');
    const next = (base ? base + '\n\n' : '') + BLOCK;
    await writeFile(path, next, 'utf-8');
    return { changed: true, created };
  } catch {
    return { changed: false, reason: 'error' };
  }
}
