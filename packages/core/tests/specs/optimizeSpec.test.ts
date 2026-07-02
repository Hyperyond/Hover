import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  optimizeSpec, buildOptimizePrompt, extractCode, validateSpecCode, OptimizeError, gatherSuiteContext,
  buildOptimizeBrief, saveOptimizedCandidate, promoteOptimizedCandidate,
} from '../../src/specs/optimizeSpec.js';
import type { SpecSidecar } from '../../src/specs/sidecar.js';

describe('extractCode', () => {
  it('strips a ```ts fence', () => {
    expect(extractCode('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
  });
  it('returns the raw text when there is no fence', () => {
    expect(extractCode('  const a = 1;  ')).toBe('const a = 1;');
  });
});

const GOOD = `import { test, expect } from '@playwright/test';
test('x', async ({ page }) => { await expect(page.getByText('ok')).toBeVisible(); });`;

describe('validateSpecCode', () => {
  it('accepts a clean spec', () => {
    expect(validateSpecCode(GOOD).ok).toBe(true);
  });
  it('rejects waitForTimeout', () => {
    const r = validateSpecCode(`${GOOD}\nawait page.waitForTimeout(500);`);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('waitForTimeout');
  });
  it('rejects an XPath selector', () => {
    expect(validateSpecCode(
      `import {test} from '@playwright/test'; test('x', async () => { page.locator('//div'); });`,
    ).ok).toBe(false);
  });
  it('rejects output with no test() block', () => {
    expect(validateSpecCode('const a = 1;').ok).toBe(false);
  });
});

describe('buildOptimizePrompt', () => {
  it('includes the draft, the rules, the outcome, and the captured steps', () => {
    const sidecar: SpecSidecar = {
      version: 1, slug: 'x', name: 'x', createdAt: '', assertions: [],
      steps: [
        { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
        { kind: 'done', summary: 'Showed Invalid email.' },
      ],
    };
    const p = buildOptimizePrompt('TESTDRAFT', sidecar);
    expect(p).toContain('TESTDRAFT');
    expect(p).toContain('NEVER use waitForTimeout');
    expect(p).toContain('Showed Invalid email.');
    expect(p).toContain('browser_click');
  });

  it('instructs marking buggy observed behavior with a KNOWN BUG comment', () => {
    const p = buildOptimizePrompt('DRAFT', null);
    expect(p).toContain('KNOWN BUG');
    expect(p).toContain('looks like a BUG');
  });

  it('instructs de-literalizing volatile values even when not pre-flagged', () => {
    const p = buildOptimizePrompt('DRAFT', null);
    expect(p).toContain('DE-LITERALIZE VOLATILE VALUES');
    expect(p).toContain('NOT pre-flagged');
  });

  it('injects suite conventions + reusable Page Objects when provided', () => {
    const suite = {
      conventions: 'Always use data-testid for actions.',
      pages: [{ name: 'LoginPage.ts', source: 'export class LoginPage { async login() {} }' }],
    };
    const p = buildOptimizePrompt('DRAFT', null, [], suite);
    expect(p).toContain('PROJECT CONVENTIONS');
    expect(p).toContain('Always use data-testid');
    expect(p).toContain('REUSABLE PAGE OBJECTS');
    expect(p).toContain('LoginPage.ts');
    expect(p).toContain('class LoginPage');
  });

  it('omits the context sections when no suite context is available', () => {
    const p = buildOptimizePrompt('DRAFT', null);
    expect(p).not.toContain('PROJECT CONVENTIONS');
    expect(p).not.toContain('REUSABLE PAGE OBJECTS');
  });
});

describe('gatherSuiteContext', () => {
  let devRoot: string;
  beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-suite-')); });
  afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

  it('reads conventions.md + __vibe_tests__/pages/*.ts', async () => {
    mkdirSync(join(devRoot, '.hover'), { recursive: true });
    writeFileSync(join(devRoot, '.hover', 'conventions.md'), 'Prefer getByRole.');
    mkdirSync(join(devRoot, '__vibe_tests__', 'pages'), { recursive: true });
    writeFileSync(join(devRoot, '__vibe_tests__', 'pages', 'CartPage.ts'), 'export class CartPage {}');
    const suite = await gatherSuiteContext(devRoot);
    expect(suite.conventions).toBe('Prefer getByRole.');
    expect(suite.pages.map(p => p.name)).toEqual(['CartPage.ts']);
    expect(suite.pages[0].source).toContain('class CartPage');
  });

  it('returns empty (never throws) when nothing exists', async () => {
    const suite = await gatherSuiteContext(devRoot);
    expect(suite.conventions).toBeUndefined();
    expect(suite.pages).toEqual([]);
  });
});

describe('optimizeSpec', () => {
  let devRoot: string;
  beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-opt-')); });
  afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

  function seedSpec(): void {
    mkdirSync(join(devRoot, '__vibe_tests__', '.hover'), { recursive: true });
    writeFileSync(
      join(devRoot, '__vibe_tests__', 'login.spec.ts'),
      `import { test, expect } from '@playwright/test';\ntest('login', async ({ page }) => {});\n`,
      'utf-8',
    );
    writeFileSync(
      join(devRoot, '__vibe_tests__', '.hover', 'login.json'),
      JSON.stringify({
        version: 1, slug: 'login', name: 'login', createdAt: '',
        steps: [{ kind: 'done', summary: 'ok' }], assertions: [],
      }),
      'utf-8',
    );
  }

  it('writes a validated candidate to .hover/optimized/, never the original', async () => {
    seedSpec();
    const optimized = `import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
  await expect(page.getByText('Welcome')).toBeVisible();
});`;
    const res = await optimizeSpec(devRoot, 'login', async () => optimized);

    expect(res.candidatePath.endsWith('login.spec.ts.draft')).toBe(true);
    expect(res.candidatePath).toContain(join('.hover', 'cache', 'optimized'));
    expect(existsSync(res.candidatePath)).toBe(true);
    // original is untouched
    expect(readFileSync(join(devRoot, '__vibe_tests__', 'login.spec.ts'), 'utf-8'))
      .toContain("test('login', async ({ page }) => {});");
    // candidate carries the new assertion
    expect(readFileSync(res.candidatePath, 'utf-8')).toContain("getByText('Welcome')");
  });

  it('soft-batches the LLM candidate: a trailing run of ≥2 assertions becomes expect.soft', async () => {
    seedSpec();
    const optimized = `import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('a')).toHaveText('1');
  await expect(page.getByTestId('b')).toHaveText('2');
});`;
    const res = await optimizeSpec(devRoot, 'login', async () => optimized);
    const code = readFileSync(res.candidatePath, 'utf-8');
    expect(code).toContain("expect.soft(page.getByTestId('a'))");
    expect(code).toContain("expect.soft(page.getByTestId('b'))");
    expect(code).toContain("await page.goto('/');"); // action untouched
  });

  it('does not soft-batch a single trailing assertion (soft buys nothing)', async () => {
    seedSpec();
    const optimized = `import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome')).toBeVisible();
});`;
    const res = await optimizeSpec(devRoot, 'login', async () => optimized);
    const code = readFileSync(res.candidatePath, 'utf-8');
    expect(code).toContain("await expect(page.getByText('Welcome'))");
    expect(code).not.toContain('expect.soft');
  });

  it('strips a fence the model added around its output', async () => {
    seedSpec();
    const res = await optimizeSpec(devRoot, 'login', async () =>
      "```ts\nimport { test, expect } from '@playwright/test';\ntest('login', async ({ page }) => { await expect(page.getByText('x')).toBeVisible(); });\n```");
    expect(readFileSync(res.candidatePath, 'utf-8')).not.toContain('```');
  });

  it('throws OptimizeError when the LLM output fails validation', async () => {
    seedSpec();
    await expect(optimizeSpec(devRoot, 'login', async () => 'await page.waitForTimeout(9999);'))
      .rejects.toThrow(OptimizeError);
  });

  it('throws when the spec does not exist', async () => {
    await expect(optimizeSpec(devRoot, 'nope', async () => 'x')).rejects.toThrow(OptimizeError);
  });

});

// MCP-first split: the agent (not a Hover-owned model) is the intelligence.
// buildOptimizeBrief hands it the brief; saveOptimizedCandidate files its result.
describe('buildOptimizeBrief + saveOptimizedCandidate (MCP-first optimize)', () => {
  let devRoot: string;
  beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-opt2-')); });
  afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

  function seedSpec(): void {
    mkdirSync(join(devRoot, '__vibe_tests__', '.hover'), { recursive: true });
    writeFileSync(
      join(devRoot, '__vibe_tests__', 'checkout.spec.ts'),
      `import { test, expect } from '@playwright/test';\ntest('checkout', async ({ page }) => {});\n`,
      'utf-8',
    );
    writeFileSync(
      join(devRoot, '__vibe_tests__', '.hover', 'checkout.json'),
      JSON.stringify({
        version: 2, slug: 'checkout', name: 'checkout', createdAt: '',
        steps: [{ kind: 'done', summary: 'order confirmed' }], assertions: [],
      }),
      'utf-8',
    );
  }

  it('builds a brief that carries the spec, the observed outcome, and the save_optimized_spec directive', async () => {
    seedSpec();
    const { prompt, original } = await buildOptimizeBrief(devRoot, 'checkout');
    expect(prompt).toContain("test('checkout'"); // the current spec is included
    expect(prompt).toContain('order confirmed'); // the observed outcome is included
    // the agent path ends by CALLING the tool, not by emitting raw text
    expect(prompt).toContain('save_optimized_spec');
    expect(prompt).toContain('checkout.spec.ts.draft');
    expect(prompt).not.toContain('Output ONLY the complete .ts file');
    expect(original).toContain("test('checkout'");
  });

  it('throws OptimizeError when the spec does not exist', async () => {
    await expect(buildOptimizeBrief(devRoot, 'ghost')).rejects.toThrow(OptimizeError);
  });

  it('files a validated candidate to .hover/cache/optimized/, never the original', async () => {
    seedSpec();
    const improved = `import { test, expect } from '@playwright/test';
test('checkout', async ({ page }) => {
  await expect(page.getByText('Order confirmed')).toBeVisible();
});`;
    const { candidatePath, code } = await saveOptimizedCandidate(devRoot, 'checkout', improved);
    expect(candidatePath.endsWith('checkout.spec.ts.draft')).toBe(true);
    expect(candidatePath).toContain(join('.hover', 'cache', 'optimized'));
    expect(existsSync(candidatePath)).toBe(true);
    expect(code).toContain("getByText('Order confirmed')");
    // the original spec is untouched
    expect(readFileSync(join(devRoot, '__vibe_tests__', 'checkout.spec.ts'), 'utf-8'))
      .toContain("test('checkout', async ({ page }) => {});");
  });

  it('rejects (throws) an agent result that violates the guardrails', async () => {
    seedSpec();
    await expect(saveOptimizedCandidate(devRoot, 'checkout', 'await page.waitForTimeout(9999);'))
      .rejects.toThrow(OptimizeError);
  });

  it('promoteOptimizedCandidate applies the draft over the spec + removes the draft', async () => {
    seedSpec();
    const improved = `import { test, expect } from '@playwright/test';\ntest('checkout', async ({ page }) => {\n  await expect(page.getByText('Order confirmed')).toBeVisible();\n});`;
    const { candidatePath } = await saveOptimizedCandidate(devRoot, 'checkout', improved);
    const { path } = await promoteOptimizedCandidate(devRoot, 'checkout');
    expect(path.endsWith(join('__vibe_tests__', 'checkout.spec.ts'))).toBe(true);
    expect(readFileSync(path, 'utf-8')).toContain("getByText('Order confirmed')"); // spec now = the candidate
    expect(existsSync(candidatePath)).toBe(false); // draft removed
  });

  it('promoteOptimizedCandidate throws when there is no candidate', async () => {
    await expect(promoteOptimizedCandidate(devRoot, 'ghost')).rejects.toThrow(OptimizeError);
  });
});
