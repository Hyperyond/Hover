import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  optimizeSpec, buildOptimizePrompt, extractCode, validateSpecCode, OptimizeError,
  promoteOptimized, discardOptimized,
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
    expect(res.candidatePath).toContain(join('.hover', 'optimized'));
    expect(existsSync(res.candidatePath)).toBe(true);
    // original is untouched
    expect(readFileSync(join(devRoot, '__vibe_tests__', 'login.spec.ts'), 'utf-8'))
      .toContain("test('login', async ({ page }) => {});");
    // candidate carries the new assertion
    expect(readFileSync(res.candidatePath, 'utf-8')).toContain("getByText('Welcome')");
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

  const goodCandidate = async () =>
    `import { test, expect } from '@playwright/test';\ntest('login', async ({ page }) => { await expect(page.getByText('Y')).toBeVisible(); });`;

  it('promoteOptimized overwrites the spec with the candidate and removes the draft', async () => {
    seedSpec();
    const res = await optimizeSpec(devRoot, 'login', goodCandidate);
    const specPath = await promoteOptimized(devRoot, 'login');
    expect(readFileSync(specPath, 'utf-8')).toContain("getByText('Y')");
    expect(existsSync(res.candidatePath)).toBe(false); // draft consumed
  });

  it('discardOptimized deletes the draft and leaves the spec intact', async () => {
    seedSpec();
    const res = await optimizeSpec(devRoot, 'login', goodCandidate);
    await discardOptimized(devRoot, 'login');
    expect(existsSync(res.candidatePath)).toBe(false);
    expect(readFileSync(join(devRoot, '__vibe_tests__', 'login.spec.ts'), 'utf-8'))
      .toContain('async ({ page }) => {});'); // original untouched
  });

  it('promoteOptimized throws when there is no candidate', async () => {
    seedSpec();
    await expect(promoteOptimized(devRoot, 'login')).rejects.toThrow(OptimizeError);
  });
});
