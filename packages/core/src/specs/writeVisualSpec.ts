/**
 * Visual-regression spec writer — the third test type.
 *
 * Emits a plain `@playwright/test` spec that navigates to each captured page and
 * asserts `toHaveScreenshot` against a committed baseline. 100% deterministic,
 * ZERO AI at run time (pixel diff, not a model) — same moat as every other
 * Hover type. Baselines are generated on the first run (`--update-snapshots`)
 * and committed; drift = a real visual change to review.
 *
 * Lives at `__vibe_tests__/visual/<slug>.visual.spec.ts`. Login-gated pages are
 * covered by the shared storageState the auth fixture sets up, same as e2e.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { specDir, specPath } from './specPaths.js';

export interface VisualCapture {
  /** Human name for the assertion, e.g. "checkout page". */
  name: string;
  /** URL or same-origin path to screenshot. */
  url: string;
  /** Full-page screenshot (default true) vs viewport only. */
  fullPage?: boolean;
}

export interface WriteVisualSpecOptions {
  devRoot: string;
  name: string;
  description?: string;
  captures: VisualCapture[];
  /** App base — a same-origin path in a capture is resolved against it. */
  startUrl?: string;
  overwrite?: boolean;
}

export interface WriteVisualSpecResult {
  path: string;
  slug: string;
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const q = (s: string): string => JSON.stringify(s);

/** Resolve a same-origin path against startUrl; absolute URLs pass through. */
function resolveUrl(url: string, startUrl?: string): string {
  try {
    return new URL(url).href;
  } catch {
    if (!startUrl) return url;
    try {
      return new URL(url, startUrl).href;
    } catch {
      return url;
    }
  }
}

export async function writeVisualSpec(opts: WriteVisualSpecOptions): Promise<WriteVisualSpecResult> {
  const slug = slugify(opts.name);
  if (!slug) throw new Error('visual spec name must contain at least one alphanumeric character');
  if (!opts.captures.length) throw new Error('visual spec needs at least one capture');

  const dir = specDir(opts.devRoot, 'visual');
  const path = specPath(opts.devRoot, 'visual', slug);
  if (existsSync(path) && !opts.overwrite) {
    throw new Error(`${path} already exists (pass overwrite to replace)`);
  }

  const header = opts.description ? `// ${opts.description.split(/(?<=[.!?])\s/)[0]}` : null;
  const cases = opts.captures.map((c) => {
    const name = c.name.trim() || 'page';
    const shot = `${slug}-${slugify(name)}.png`;
    return [
      `  test(${q(`${name} matches its visual baseline`)}, async ({ page }) => {`,
      `    await page.goto(${q(resolveUrl(c.url, opts.startUrl))});`,
      `    await expect(page).toHaveScreenshot(${q(shot)}, { fullPage: ${c.fullPage !== false}, maxDiffPixelRatio: 0.01 });`,
      `  });`,
    ].join('\n');
  });

  const lines = [
    ...(header ? [header] : []),
    `import { test, expect } from '@playwright/test';`,
    ``,
    `// Visual regression — deterministic pixel diff, no AI. Baselines are`,
    `// generated on first run (\`playwright test --update-snapshots\`) and committed.`,
    `test.describe(${q(`visual: ${opts.name}`)}, () => {`,
    cases.join('\n\n'),
    `});`,
    ``,
  ];

  await mkdir(dir, { recursive: true });
  await writeFile(path, lines.join('\n'), 'utf-8');
  return { path, slug };
}
