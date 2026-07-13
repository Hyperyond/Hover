/**
 * Single source of truth for where crystallized specs live — the multi-type
 * layout `__vibe_tests__/{e2e,visual,api,a11y}/`.
 *
 * Hover crystallizes four deterministic test types, each AI-free at run time:
 *   e2e    — grounded user flows (click/fill/assert)          → `.spec.ts`
 *   visual — screenshot baselines (Playwright toHaveScreenshot) → `.visual.spec.ts`
 *   api    — request contracts (status/shape/authz)            → `.api-test.spec.ts`
 *   a11y   — accessibility scans (axe-core)                    → `.a11y.spec.ts`
 *
 * Every suffix ends in `.spec.ts`, so Playwright's default testMatch picks up
 * all four with no config. Type is recoverable from the filename alone (survives
 * a move); the folder is for humans + the map's grouping. Sidecars stay
 * slug-keyed in `.hover/sidecars/` — independent of which folder a spec is in.
 */
import { join } from 'node:path';

export type SpecType = 'e2e' | 'visual' | 'api' | 'a11y';

export const SPEC_TYPES: Record<SpecType, { dir: string; suffix: string; label: string }> = {
  e2e: { dir: 'e2e', suffix: '.spec.ts', label: 'E2E flow' },
  visual: { dir: 'visual', suffix: '.visual.spec.ts', label: 'Visual regression' },
  api: { dir: 'api', suffix: '.api-test.spec.ts', label: 'API contract' },
  a11y: { dir: 'a11y', suffix: '.a11y.spec.ts', label: 'Accessibility' },
};

export const VIBE_DIR = '__vibe_tests__';

export const vibeDir = (devRoot: string): string => join(devRoot, VIBE_DIR);

export const specDir = (devRoot: string, type: SpecType): string =>
  join(vibeDir(devRoot), SPEC_TYPES[type].dir);

export const specFileName = (slug: string, type: SpecType): string =>
  `${slug}${SPEC_TYPES[type].suffix}`;

export const specPath = (devRoot: string, type: SpecType, slug: string): string =>
  join(specDir(devRoot, type), specFileName(slug, type));

/** Infer a spec's type from its filename. The specific suffixes are checked
 *  before the bare `.spec.ts` (which every suffix ends with). */
export function specTypeOf(file: string): SpecType {
  if (file.endsWith(SPEC_TYPES.api.suffix)) return 'api';
  if (file.endsWith(SPEC_TYPES.visual.suffix)) return 'visual';
  if (file.endsWith(SPEC_TYPES.a11y.suffix)) return 'a11y';
  return 'e2e';
}

/** The slug for a spec filename (strip the type suffix). */
export function slugOfSpecFile(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.(visual|a11y)\.spec\.ts$/, '').replace(/\.api-test\.spec\.ts$/, '').replace(/\.spec\.tsx?$/, '');
}
