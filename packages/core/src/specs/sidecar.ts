/**
 * Structured-session sidecar for a generated spec.
 *
 * Every saved spec gets a companion `.hover/sidecars/<slug>.json` holding
 * the original structured `SpecStep[]` (plus assertions + metadata). The
 * `.spec.ts` is the human / CI artifact; this sidecar is the machine record
 * that downstream work reads instead of parsing generated code:
 *   - F4 cross-session extraction signature-matches `steps` across sidecars.
 *   - F7 optimization pass feeds the draft + this sidecar to the LLM.
 *
 * Home is the project-root `.hover/` directory (same home as `.hover/rules/`
 * seeds and `.hover/conventions.md`) — Hover-derived data lives outside
 * `__vibe_tests__/`, which stays 100% user-owned Playwright code. Sidecars
 * historically lived nested at `__vibe_tests__/.hover/<slug>.json`; readers
 * fall back to that legacy path and lazily copy-forward, so pre-existing
 * projects keep working without a migration step.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillStep } from '../specs/specStep.js';
import type { SpecAssertion } from './writeSpec.js';

/** Current sidecar schema version. Bump when the shape changes so readers
 *  (Stage 2 detection, Stage 7 optimization) can migrate or skip cleanly. */
export const SIDECAR_VERSION = 1;

export interface SpecSidecar {
  version: number;
  slug: string;
  name: string;
  /** ISO timestamp the sidecar was written. */
  createdAt: string;
  /** The full captured session, structured and verbatim — never re-derived
   *  from the generated `.spec.ts`. */
  steps: SkillStep[];
  /** Alt-click assertions captured alongside the session. */
  assertions: SpecAssertion[];
}

/** Project-root `.hover/` directory — the single home for Hover-derived data
 *  (sidecars, sessions, rules, conventions). */
export function hoverDir(devRoot: string): string {
  return join(devRoot, '.hover');
}

/** Sidecar directory: `<devRoot>/.hover/sidecars`. Outside `__vibe_tests__/`,
 *  so Playwright's default `*.spec.ts` glob trivially never reaches it. */
export function sidecarDir(devRoot: string): string {
  return join(hoverDir(devRoot), 'sidecars');
}

/** Pre-relocation sidecar home (`__vibe_tests__/.hover/`). Read-only fallback;
 *  nothing writes here anymore. */
export function legacySidecarDir(devRoot: string): string {
  return join(devRoot, '__vibe_tests__', '.hover');
}

/** Write the structured-session sidecar at `.hover/sidecars/<slug>.json`.
 *  Caller passes the data minus the stamped fields (`version`, `createdAt`),
 *  which this function fills. Returns the absolute path written. */
export async function writeSidecar(
  devRoot: string,
  data: Omit<SpecSidecar, 'version' | 'createdAt'>,
): Promise<string> {
  const dir = sidecarDir(devRoot);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${data.slug}.json`);
  const sidecar: SpecSidecar = {
    version: SIDECAR_VERSION,
    createdAt: new Date().toISOString(),
    ...data,
  };
  await writeFile(path, JSON.stringify(sidecar, null, 2) + '\n', 'utf-8');
  return path;
}

/**
 * Read one sidecar by slug, with legacy fallback + lazy copy-forward: when a
 * sidecar only exists at the pre-relocation `__vibe_tests__/.hover/` path it
 * is parsed from there and best-effort re-written into `.hover/sidecars/` so
 * the next read hits the new home. Returns `null` when absent or malformed.
 */
export async function readSidecar(devRoot: string, slug: string): Promise<SpecSidecar | null> {
  const current = await parseSidecarFile(join(sidecarDir(devRoot), `${slug}.json`));
  if (current) return current;
  const legacy = await parseSidecarFile(join(legacySidecarDir(devRoot), `${slug}.json`));
  if (legacy) {
    // Copy-forward, best effort — a read must never fail because the
    // migration write did.
    try {
      const dir = sidecarDir(devRoot);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, `${slug}.json`),
        JSON.stringify(legacy, null, 2) + '\n',
        'utf-8',
      );
    } catch {
      /* leave it in the legacy home */
    }
  }
  return legacy;
}

/** Parse one sidecar file, or `null` when absent / not JSON. Deliberately
 *  lenient on shape (an empty `{}` still counts as "a sidecar exists") —
 *  consumers that need `steps`/`slug` filter for themselves. */
export async function parseSidecarFile(path: string): Promise<SpecSidecar | null> {
  try {
    const sc = JSON.parse(await readFile(path, 'utf-8')) as SpecSidecar;
    return sc && typeof sc === 'object' ? sc : null;
  } catch {
    return null;
  }
}
