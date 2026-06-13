/**
 * Translation seeds (Stage 6, approach A): human-written worked examples that
 * teach the optimization pass (F7) a pattern by few-shot, NOT by deterministic
 * match+template. A seed is a rough `signature` (tool names, used only to pick
 * relevant seeds) + a concrete `example` (input steps → output code) the LLM
 * generalizes from.
 *
 * Two sources, merged:
 *   1. Built-in seeds shipped inside Hover — JSON files in this package's
 *      `seeds/optimization/` directory (loaded by `readBuiltinSeeds`).
 *   2. The project's own `<projectRoot>/.hover/rules/*.json`.
 *
 * Adding a built-in pattern = dropping a JSON in `packages/core/seeds/
 * optimization/`; adding a project pattern = dropping one in `.hover/rules/`.
 * No core code change either way. The full catalogue ships with Hover so users
 * never have to fetch seeds from a second repo — a user who wants to suppress a
 * built-in lists its name under `disabled` in `<projectRoot>/.hover/seeds.json`.
 */
import { readFile, readdir } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SeedRule {
  /** Identifier, e.g. `download`. */
  name: string;
  /** Rough match signature — tool names (optionally `tool:detail`), used only
   *  to pick relevant seeds for a spec, NOT for exact matching. */
  signature: string[];
  /** One-line human note: what the pattern is / when it applies. */
  note?: string;
  /** A concrete worked example the LLM generalizes from. */
  example: { steps: unknown[]; code: string };
}

/** True when `o` is a structurally-valid optimization seed. */
function isSeedRule(o: unknown): o is SeedRule {
  const s = o as SeedRule | null;
  return !!s && typeof s.name === 'string' && Array.isArray(s.signature) && !!s.example?.code;
}

/** Directory of bundled built-in seed JSONs, resolved relative to this module
 *  so it works from both `src/` (tests) and `dist/` (published) — both are two
 *  levels below the package root where `seeds/` lives. */
const BUILTIN_SEEDS_DIR = new URL('../../seeds/optimization/', import.meta.url);

/**
 * Built-in seeds ship with Hover and feed EVERY project's optimization pass.
 * Loaded synchronously at module init from the bundled `seeds/optimization/`
 * directory so the export stays a plain constant (the optimize prompt builder
 * and the `list-seeds` handler consume it synchronously). A missing or
 * malformed file is skipped rather than failing the read.
 */
function readBuiltinSeeds(): SeedRule[] {
  const out: SeedRule[] = [];
  try {
    for (const f of readdirSync(BUILTIN_SEEDS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s: unknown = JSON.parse(readFileSync(new URL(f, BUILTIN_SEEDS_DIR), 'utf-8'));
        if (isSeedRule(s)) out.push(s);
      } catch {
        /* skip malformed built-in seed file */
      }
    }
  } catch {
    /* no bundled seeds directory (should not happen in a published package) */
  }
  return out;
}

export const BUILTIN_SEEDS: SeedRule[] = readBuiltinSeeds();

/** Names a project disabled via `<projectRoot>/.hover/seeds.json`
 *  (`{ "disabled": ["oauth-popup", …] }`). Best-effort; absent file → none. */
async function readDisabledSeeds(projectRoot: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(projectRoot, '.hover', 'seeds.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { disabled?: unknown };
    if (Array.isArray(cfg.disabled)) {
      return new Set(cfg.disabled.filter((n): n is string => typeof n === 'string'));
    }
  } catch {
    /* no .hover/seeds.json, or malformed — disable nothing */
  }
  return new Set();
}

/** Built-in seeds + any in `<projectRoot>/.hover/rules/*.json`, minus any name
 *  the project disabled in `.hover/seeds.json`. Malformed files are skipped
 *  rather than failing the whole read. */
export async function readSeeds(projectRoot: string): Promise<SeedRule[]> {
  const out: SeedRule[] = [...BUILTIN_SEEDS];
  try {
    const dir = join(projectRoot, '.hover', 'rules');
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(await readFile(join(dir, f), 'utf-8')) as SeedRule;
        if (isSeedRule(s)) out.push(s);
      } catch {
        /* skip malformed seed file */
      }
    }
  } catch {
    /* no .hover/rules/ directory */
  }
  const disabled = await readDisabledSeeds(projectRoot);
  return disabled.size ? out.filter(s => !disabled.has(s.name)) : out;
}

/** Pick seeds whose signature's base tool appears in the spec — a cheap
 *  relevance filter so the prompt only carries plausibly-applicable examples. */
export function relevantSeeds(seeds: SeedRule[], specTools: Set<string>, cap = 6): SeedRule[] {
  const hits = seeds.filter(s => s.signature.some(sig => specTools.has(sig.split(':')[0])));
  return hits.slice(0, cap);
}
