/**
 * Accessibility spec writer — the fourth test type.
 *
 * Emits a plain `@playwright/test` spec that runs axe-core (via
 * `@axe-core/playwright`) against each page and fails on serious/critical
 * violations. 100% deterministic, ZERO AI at run time (axe is a rule engine).
 * Needs `@axe-core/playwright` as a devDependency in the user's repo (the CI
 * workflow installs it).
 *
 * Lives at `__vibe_tests__/a11y/<slug>.a11y.spec.ts`. Default ruleset is
 * WCAG 2.0/2.1 A + AA; the impact gate keeps it actionable (serious/critical),
 * with the failing rule ids in the assertion message.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { specDir, specPath } from './specPaths.js';

export interface A11yPage {
  /** Human name, e.g. "sign-in page". */
  name: string;
  /** URL or same-origin path to scan. */
  url: string;
}

export interface WriteA11ySpecOptions {
  devRoot: string;
  name: string;
  description?: string;
  pages: A11yPage[];
  startUrl?: string;
  /** axe tags; defaults to WCAG A + AA. */
  tags?: string[];
  /** Minimum impact that fails the test; defaults to serious+critical. */
  failOn?: ('minor' | 'moderate' | 'serious' | 'critical')[];
  overwrite?: boolean;
}

export interface WriteA11ySpecResult {
  path: string;
  slug: string;
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const q = (s: string): string => JSON.stringify(s);

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

const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const DEFAULT_FAIL_ON = ['serious', 'critical'];

export async function writeA11ySpec(opts: WriteA11ySpecOptions): Promise<WriteA11ySpecResult> {
  const slug = slugify(opts.name);
  if (!slug) throw new Error('a11y spec name must contain at least one alphanumeric character');
  if (!opts.pages.length) throw new Error('a11y spec needs at least one page');

  const dir = specDir(opts.devRoot, 'a11y');
  const path = specPath(opts.devRoot, 'a11y', slug);
  if (existsSync(path) && !opts.overwrite) {
    throw new Error(`${path} already exists (pass overwrite to replace)`);
  }

  const tags = opts.tags?.length ? opts.tags : DEFAULT_TAGS;
  const failOn = opts.failOn?.length ? opts.failOn : DEFAULT_FAIL_ON;
  const header = opts.description ? `// ${opts.description.split(/(?<=[.!?])\s/)[0]}` : null;

  const cases = opts.pages.map((p) => {
    const name = p.name.trim() || 'page';
    return [
      `  test(${q(`${name} has no ${failOn.join('/')} accessibility violations`)}, async ({ page }) => {`,
      `    await page.goto(${q(resolveUrl(p.url, opts.startUrl))});`,
      `    const results = await new AxeBuilder({ page }).withTags(${JSON.stringify(tags)}).analyze();`,
      `    const blocking = results.violations.filter((v) => ${JSON.stringify(failOn)}.includes(v.impact ?? ''));`,
      `    expect(blocking.map((v) => v.id).join(', ') || 'none', 'accessibility violations').toBe('none');`,
      `  });`,
    ].join('\n');
  });

  const lines = [
    ...(header ? [header] : []),
    `import { test, expect } from '@playwright/test';`,
    `import AxeBuilder from '@axe-core/playwright';`,
    ``,
    `// Accessibility — deterministic axe-core rule engine, no AI.`,
    `test.describe(${q(`a11y: ${opts.name}`)}, () => {`,
    cases.join('\n\n'),
    `});`,
    ``,
  ];

  await mkdir(dir, { recursive: true });
  await writeFile(path, lines.join('\n'), 'utf-8');
  return { path, slug };
}
