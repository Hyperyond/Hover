import { describe, it, expect } from 'vitest';
import { authPrefixLength, addSetupProjectToConfig } from '../../src/specs/authFixture.js';
import type { SkillStep } from '../../src/specs/specStep.js';

// Helpers to build POST-redaction action steps (credentials already rewritten
// to `process.env.<envVar> ?? ''`, exactly as redactSteps emits).
const nav = (url: string): SkillStep => ({ kind: 'step', tool: 'browser_navigate', input: { url } });
const type = (text: string): SkillStep => ({ kind: 'step', tool: 'browser_type', input: { text } });
const fill = (value: string): SkillStep => ({ kind: 'step', tool: 'fill_control', input: { value } });
const click = (name: string): SkillStep => ({ kind: 'step', tool: 'click_control', input: { role: 'button', name } });
const env = (v: string) => `process.env.${v} ?? ''`;

const USER = 'HOVER_USER';
const PASS = 'HOVER_PASS';

describe('authPrefixLength', () => {
  it('returns 0 with no redactions (no auth → inline behavior, no regression)', () => {
    const actions = [nav('/'), type('hello'), click('Submit')];
    expect(authPrefixLength(actions, [])).toBe(0);
  });

  it('returns 0 when redactions exist but no credential is filled in the steps', () => {
    const actions = [nav('/'), click('Start Learning'), click('I know this')];
    expect(authPrefixLength(actions, [USER, PASS])).toBe(0);
  });

  it('captures navigate → email → password → submit (browser_type)', () => {
    const actions = [nav('/login'), type(env(USER)), type(env(PASS)), click('Sign in'), click('Add to cart')];
    expect(authPrefixLength(actions, [USER, PASS])).toBe(4); // through the Sign in click
  });

  it('captures a grounded fill_control login + submit', () => {
    const actions = [fill(env(USER)), fill(env(PASS)), click('Log in'), click('Checkout')];
    expect(authPrefixLength(actions, [USER, PASS])).toBe(3);
  });

  it('captures a browser_fill_form login (env value in a field) + submit', () => {
    const form: SkillStep = {
      kind: 'step',
      tool: 'browser_fill_form',
      input: { fields: [{ name: 'Email', value: env(USER) }, { name: 'Password', value: env(PASS) }] },
    };
    const actions = [nav('/login'), form, click('Sign in'), click('Buy now')];
    expect(authPrefixLength(actions, [USER, PASS])).toBe(3);
  });

  it('stops at the last credential fill when login auto-submits (no following click)', () => {
    const actions = [type(env(USER)), type(env(PASS)), type('search term'), click('Search')];
    expect(authPrefixLength(actions, [USER, PASS])).toBe(2); // creds only; next step is not a click
  });

  it('does not count business clicks after the login submit', () => {
    const actions = [type(env(USER)), type(env(PASS)), click('Sign in'), click('a'), click('b'), click('c')];
    expect(authPrefixLength(actions, [USER, PASS])).toBe(3);
  });
});

describe('addSetupProjectToConfig (Stage 4a — ts-morph config edit)', () => {
  it('inserts a setup project into a Hover-scaffolded defineConfig', () => {
    const src = [
      "import { defineConfig } from '@playwright/test';",
      'export default defineConfig({',
      "  testDir: './__vibe_tests__',",
      "  use: { baseURL: 'http://localhost:5175' },",
      '});',
      '',
    ].join('\n');
    const out = addSetupProjectToConfig(src);
    expect(out).toBeTruthy();
    expect(out).toContain("name: 'setup'");
    expect(out).toContain("dependencies: ['setup']");
    // Preserves the original content.
    expect(out).toContain("testDir: './__vibe_tests__'");
    expect(out).toContain("baseURL: 'http://localhost:5175'");
  });

  it('inserts into a bare `export default {}` object', () => {
    const out = addSetupProjectToConfig('export default { testDir: "./tests" };');
    expect(out).toBeTruthy();
    expect(out).toContain("name: 'setup'");
  });

  it('returns null when the config already has a projects array (do not risk merging)', () => {
    const src = [
      "import { defineConfig } from '@playwright/test';",
      'export default defineConfig({',
      '  projects: [{ name: "chromium" }],',
      '});',
    ].join('\n');
    expect(addSetupProjectToConfig(src)).toBeNull();
  });

  it('returns null when no config object can be found', () => {
    expect(addSetupProjectToConfig('const x = 1; console.log(x);')).toBeNull();
  });
});
