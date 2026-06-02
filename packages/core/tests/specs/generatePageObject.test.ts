import { describe, it, expect } from 'vitest';
import { generatePageObject } from '../../src/specs/generatePageObject.js';
import type { SkillStep } from '../../src/skills/writeSkill.js';

const loginFlow: SkillStep[] = [
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
  {
    kind: 'step',
    tool: 'browser_fill_form',
    input: {
      fields: [
        { name: 'Email', type: 'email', value: 'a@b.co' },
        { name: 'Password', type: 'password', value: 'secret' },
      ],
    },
  },
  { kind: 'step', tool: 'browser_click', input: { element: 'Sign in button' } },
];

describe('generatePageObject', () => {
  it('names the class/method from the entry navigation (D7)', () => {
    const po = generatePageObject(loginFlow);
    expect(po.className).toBe('LoginPage');
    expect(po.methodName).toBe('login');
    expect(po.fileName).toBe('LoginPage.ts');
  });

  it('turns data values into method parameters, never inlining them (D4)', () => {
    const po = generatePageObject(loginFlow);
    expect(po.source).toContain('async login(email: string, password: string): Promise<void>');
    expect(po.source).not.toContain('a@b.co');
    expect(po.source).not.toContain('secret');
    expect(po.source).toContain('await el.fill(email);');
    expect(po.source).toContain('await el.fill(password);');
  });

  it('centralizes this.page selectors with visibility preludes', () => {
    const po = generatePageObject(loginFlow);
    expect(po.source).toContain('await this.page.goto("/login");');
    expect(po.source).toContain('const el = this.page.getByRole(\'textbox\', { name: "Email" });');
    expect(po.source).toContain('const el = this.page.getByRole(\'button\', { name: "Sign in" });');
    expect(po.source).toContain('await expect(el).toBeVisible();');
    expect(po.source).toContain("import { expect, type Page } from '@playwright/test';");
  });

  it('block-scopes each interaction so el declarations do not collide', () => {
    const po = generatePageObject(loginFlow);
    const elDecls = po.source.match(/const el =/g) ?? [];
    expect(elDecls.length).toBe(3); // email, password, sign-in
    const openBlocks = po.source.match(/^\s*\{$/gm) ?? [];
    expect(openBlocks.length).toBe(3);
  });

  it('falls back to FlowPage.run when there is no navigation', () => {
    const po = generatePageObject([
      { kind: 'step', tool: 'browser_click', input: { element: 'Start button' } },
    ]);
    expect(po.className).toBe('FlowPage');
    expect(po.methodName).toBe('run');
  });

  it('de-duplicates repeated parameter names', () => {
    const po = generatePageObject([
      { kind: 'step', tool: 'browser_type', input: { element: 'Email textbox', text: 'a' } },
      { kind: 'step', tool: 'browser_type', input: { element: 'Email textbox', text: 'b' } },
    ]);
    expect(po.source).toContain('async run(email: string, email2: string)');
  });
});
