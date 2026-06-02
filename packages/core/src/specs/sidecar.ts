/**
 * Structured-session sidecar for a generated spec.
 *
 * Every saved spec gets a companion `__vibe_tests__/.hover/<slug>.json` holding
 * the original structured `SpecStep[]` (plus assertions + metadata). The
 * `.spec.ts` is the human / CI artifact; this sidecar is the machine record
 * that downstream work reads instead of parsing generated code:
 *   - F4 cross-session extraction signature-matches `steps` across sidecars.
 *   - F7 optimization pass feeds the draft + this sidecar to the LLM.
 *
 * It lands in a dot-prefixed `.hover/` dir so Playwright's default `*.spec.ts`
 * glob never collects it, and it is pure data — no Hover runtime import.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillStep } from '../skills/writeSkill.js';
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

/** Sidecar directory under the spec output dir. Dot-prefixed on purpose:
 *  Playwright's default `*.spec.ts` glob never reaches into `.hover/`. */
export function sidecarDir(devRoot: string): string {
  return join(devRoot, '__vibe_tests__', '.hover');
}

/** Write the structured-session sidecar at `.hover/<slug>.json`. Caller passes
 *  the data minus the stamped fields (`version`, `createdAt`), which this
 *  function fills. Returns the absolute path written. */
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
