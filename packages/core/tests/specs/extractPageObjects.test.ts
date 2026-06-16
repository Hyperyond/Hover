import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSidecar } from '../../src/specs/sidecar.js';
import { extractPageObjects } from '../../src/specs/extractPageObjects.js';
import { writeSpec } from '../../src/specs/writeSpec.js';
import type { SkillStep } from '../../src/specs/specStep.js';

let devRoot: string;
beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-extract-')); });
afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

// A login entry flow shared by every spec, plus one spec-specific tail step.
const login = (tail: SkillStep): SkillStep[] => [
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
  {
    kind: 'step',
    tool: 'browser_fill_form',
    input: {
      fields: [
        { name: 'Email', type: 'email', value: 'a@b.co' },
        { name: 'Password', type: 'password', value: 'x' },
      ],
    },
  },
  { kind: 'step', tool: 'browser_click', input: { element: 'Sign in button' } },
  tail,
];

async function sc(slug: string, steps: SkillStep[]): Promise<void> {
  await writeSidecar(devRoot, { slug, name: slug, steps, assertions: [] });
}

describe('extractPageObjects', () => {
  it('writes a pages/<Name>.ts + fixtures.ts for a flow shared by >= 3 specs', async () => {
    await sc('a', login({ kind: 'step', tool: 'browser_click', input: { element: 'A button' } }));
    await sc('b', login({ kind: 'step', tool: 'browser_click', input: { element: 'B button' } }));
    await sc('c', login({ kind: 'step', tool: 'browser_click', input: { element: 'C button' } }));

    const res = await extractPageObjects(devRoot);
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0].className).toBe('LoginPage');
    expect(res.pages[0].specs).toEqual(['a', 'b', 'c']);

    const poPath = join(devRoot, '__vibe_tests__', 'pages', 'LoginPage.ts');
    expect(existsSync(poPath)).toBe(true);
    const po = readFileSync(poPath, 'utf-8');
    expect(po).toContain('export class LoginPage');
    expect(po).toContain('async login(email: string, password: string)');
    expect(po).toContain('await this.page.goto("/login");');

    const fx = readFileSync(join(devRoot, '__vibe_tests__', 'fixtures.ts'), 'utf-8');
    expect(fx).toContain("import { LoginPage } from './pages/LoginPage';");
    expect(fx).toContain('base.extend<{ loginPage: LoginPage }>');
    expect(fx).toContain('loginPage: async ({ page }, use) => {');
    expect(fx).toContain('await use(new LoginPage(page));');
    expect(fx).toContain("export { expect } from '@playwright/test';");
  });

  it('extracts nothing when fewer than 3 specs share the flow', async () => {
    await sc('a', login({ kind: 'step', tool: 'browser_click', input: { element: 'A button' } }));
    await sc('b', login({ kind: 'step', tool: 'browser_click', input: { element: 'B button' } }));

    const res = await extractPageObjects(devRoot);
    expect(res.pages).toHaveLength(0);
    expect(res.fixturesPath).toBeNull();
    expect(existsSync(join(devRoot, '__vibe_tests__', 'pages'))).toBe(false);
  });

  it('end-to-end: a spec saved after extraction consumes the generated Page Object', async () => {
    await sc('a', login({ kind: 'step', tool: 'browser_click', input: { element: 'A button' } }));
    await sc('b', login({ kind: 'step', tool: 'browser_click', input: { element: 'B button' } }));
    await sc('c', login({ kind: 'step', tool: 'browser_click', input: { element: 'C button' } }));
    await extractPageObjects(devRoot); // writes pages/LoginPage.ts + fixtures.ts + manifest

    // A NEW spec that starts with the same login flow consumes the Page Object —
    // signatures are produced by real code on both sides, so nothing is hand-written.
    const r = await writeSpec({
      devRoot,
      name: 'login then settings',
      steps: login({ kind: 'step', tool: 'browser_click', input: { element: 'Settings link' } }),
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain("import { test, expect } from './fixtures';");
    expect(src).toContain('async ({ page, loginPage }) => {');
    expect(src).toContain('await loginPage.login("a@b.co", "x");');
    expect(src).toContain('When · Click Settings link');
  });
});
