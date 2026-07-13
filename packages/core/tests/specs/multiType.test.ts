import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeVisualSpec } from '../../src/specs/writeVisualSpec.js';
import { writeA11ySpec } from '../../src/specs/writeA11ySpec.js';
import { specPath, specTypeOf, slugOfSpecFile } from '../../src/specs/specPaths.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hover-mt-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('specPaths', () => {
  it('routes each type to its folder + suffix', () => {
    expect(specPath('/r', 'e2e', 'checkout')).toBe('/r/__vibe_tests__/e2e/checkout.spec.ts');
    expect(specPath('/r', 'visual', 'checkout')).toBe('/r/__vibe_tests__/visual/checkout.visual.spec.ts');
    expect(specPath('/r', 'api', 'checkout')).toBe('/r/__vibe_tests__/api/checkout.api-test.spec.ts');
    expect(specPath('/r', 'a11y', 'checkout')).toBe('/r/__vibe_tests__/a11y/checkout.a11y.spec.ts');
  });
  it('recovers type + slug from a filename (specific suffix beats bare .spec.ts)', () => {
    expect(specTypeOf('checkout.api-test.spec.ts')).toBe('api');
    expect(specTypeOf('checkout.visual.spec.ts')).toBe('visual');
    expect(specTypeOf('checkout.a11y.spec.ts')).toBe('a11y');
    expect(specTypeOf('checkout.spec.ts')).toBe('e2e');
    expect(slugOfSpecFile('checkout.a11y.spec.ts')).toBe('checkout');
    expect(slugOfSpecFile('/x/__vibe_tests__/api/cart.api-test.spec.ts')).toBe('cart');
  });
});

describe('writeVisualSpec', () => {
  it('emits a toHaveScreenshot spec under visual/ with no AI / no axe', async () => {
    const res = await writeVisualSpec({
      devRoot: dir,
      name: 'Checkout pages',
      startUrl: 'http://app.dev',
      captures: [{ name: 'cart', url: '/cart' }, { name: 'confirm', url: 'http://app.dev/confirm', fullPage: false }],
    });
    expect(res.path).toBe(join(dir, '__vibe_tests__', 'visual', 'checkout-pages.visual.spec.ts'));
    const src = await readFile(res.path, 'utf-8');
    expect(src).toContain("import { test, expect } from '@playwright/test';");
    expect(src).toContain('toHaveScreenshot(');
    expect(src).toContain("page.goto(\"http://app.dev/cart\")");
    expect(src).toContain('fullPage: false');
    expect(src).not.toMatch(/AxeBuilder|openai|anthropic/i);
  });
  it('refuses no captures + honors overwrite', async () => {
    await expect(writeVisualSpec({ devRoot: dir, name: 'x', captures: [] })).rejects.toThrow(/at least one capture/);
    await writeVisualSpec({ devRoot: dir, name: 'dup', captures: [{ name: 'a', url: '/a' }] });
    await expect(writeVisualSpec({ devRoot: dir, name: 'dup', captures: [{ name: 'a', url: '/a' }] })).rejects.toThrow(/already exists/);
    await expect(writeVisualSpec({ devRoot: dir, name: 'dup', captures: [{ name: 'a', url: '/a' }], overwrite: true })).resolves.toBeTruthy();
  });
});

describe('writeA11ySpec', () => {
  it('emits an axe-core spec under a11y/ with the impact gate', async () => {
    const res = await writeA11ySpec({
      devRoot: dir,
      name: 'Auth',
      startUrl: 'http://app.dev',
      pages: [{ name: 'sign-in', url: '/login' }],
    });
    expect(res.path).toBe(join(dir, '__vibe_tests__', 'a11y', 'auth.a11y.spec.ts'));
    const src = await readFile(res.path, 'utf-8');
    expect(src).toContain("import AxeBuilder from '@axe-core/playwright';");
    expect(src).toContain('.withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"])');
    expect(src).toContain('["serious","critical"].includes');
    expect(src).toContain('page.goto("http://app.dev/login")');
  });
  it('accepts custom tags + failOn', async () => {
    const res = await writeA11ySpec({
      devRoot: dir,
      name: 'strict',
      pages: [{ name: 'home', url: 'http://app.dev/' }],
      tags: ['wcag2aaa'],
      failOn: ['moderate', 'serious', 'critical'],
    });
    const src = await readFile(res.path, 'utf-8');
    expect(src).toContain('.withTags(["wcag2aaa"])');
    expect(src).toContain('["moderate","serious","critical"].includes');
  });
});
