import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSpec } from '../../src/specs/writeSpec.js';
import type { SkillStep } from '../../src/skills/writeSkill.js';

let devRoot: string;
beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-spec-')); });
afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

const session: SkillStep[] = [
  { kind: 'user', text: 'log in then click + 1 three times' },
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
  { kind: 'step', tool: 'browser_type', input: { element: 'Email', text: 'a@b.co' } },
  { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+ 1 button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+ 1 button' } },
  { kind: 'step', tool: 'browser_click', input: { element: '+ 1 button' } },
  {
    kind: 'done',
    turns: 7,
    costUsd: 0.0123,
    summary: 'Counter is now at 3. All steps verified.',
  },
];

describe('writeSpec — JSDoc header', () => {
  it('renders a numbered Steps: block with the human-readable lines', async () => {
    const r = await writeSpec({ devRoot, name: 'login + counter', steps: session });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(' * Steps:');
    expect(src).toContain(' *   1. Open http://localhost:5173/');
    expect(src).toContain(' *   2. Type "a@b.co" into Email');
    expect(src).toContain(' *   3. Click Submit button');
    // The three identical +1 clicks should collapse into one line.
    expect(src).toContain(' *   4. Click + 1 button (× 3)');
    // …and the next step should be step 5, not 6 — proving the collapse.
    const stepLines = src.split('\n').filter(l => / \* {3}\d+\. /.test(l));
    expect(stepLines).toHaveLength(4);
  });

  it('renders an Expected: block with bullets when assertions are present', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'login + counter',
      steps: session,
      assertions: [
        { code: 'expect(SEL).toHaveText("3")', hint: 'counter reads 3' },
        { code: 'expect(SEL).toBeVisible()', hint: 'logout button visible' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(' * Expected:');
    expect(src).toContain(' *   • counter reads 3');
    expect(src).toContain(' *   • logout button visible');
  });

  it('falls back to the done summary first sentence when assertions are absent', async () => {
    const r = await writeSpec({ devRoot, name: 'login + counter', steps: session });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(' * Expected:');
    expect(src).toContain(' *   • Counter is now at 3.');
  });

  it('omits the Steps block when only diagnostic tool calls were captured', async () => {
    // writeSpec requires at least one step-kind event, but humanSteps drops
    // diagnostics (browser_snapshot etc.). A session with only diagnostics
    // + an assertion should render an Expected block but no Steps block.
    const r = await writeSpec({
      devRoot,
      name: 'pure assertion-only',
      steps: [
        { kind: 'user', text: 'verify' },
        { kind: 'step', tool: 'browser_snapshot', input: {} },
      ],
      assertions: [{ code: 'expect(SEL).toBeVisible()', hint: 'still visible' }],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).not.toContain(' * Steps:');
    expect(src).toContain(' * Expected:');
    expect(src).toContain(' *   • still visible');
  });

  it('escapes embedded */ in agent text so it cannot close the JSDoc', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'edge',
      steps: [
        { kind: 'user', text: 'try /* and */ injection' },
        { kind: 'step', tool: 'browser_type', input: { element: 'box', text: 'a*/b' } },
        { kind: 'done', summary: 'Done.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    // The Steps line should escape */ to *\/.
    expect(src).toContain('Type "a*\\/b" into box');
    // And the JSDoc must still be properly closed — no stray `*/` between
    // the opening /** and the test() body. (Inside the test body, `*/`
    // can legitimately appear as a substring of a string literal — e.g.
    // `.fill("a*/b")` — which is safe and shouldn't be counted.)
    const jsdocBlock = src.split("test('")[0];
    const closes = jsdocBlock.match(/\*\//g) ?? [];
    expect(closes.length).toBe(1);
  });
});

/**
 * v0.13 visible-state prelude: every interaction (click / dblclick / hover /
 * fill / selectOption) is wrapped in a block-scoped expect(...).toBeVisible()
 * check before the action. Catches the "still in the role tree but moved
 * behind a closed disclosure widget" failure mode that `getByRole` alone
 * misses by default.
 *
 * `page.goto` and `page.keyboard.press` are NOT element-targeting and stay
 * one-liners.
 */
describe('writeSpec — visible-state prelude (v0.13)', () => {
  const interactionTools: Array<{
    tool: string;
    input: Record<string, unknown>;
    expectedAction: string;
    expectedSelector: string;
  }> = [
    {
      tool: 'browser_click',
      input: { element: 'Submit button' },
      expectedAction: 'el.click()',
      expectedSelector: "getByRole('button', { name: \"Submit\" })",
    },
    {
      tool: 'browser_double_click',
      input: { element: 'Card link' },
      expectedAction: 'el.dblclick()',
      expectedSelector: "getByRole('link', { name: \"Card\" })",
    },
    {
      tool: 'browser_hover',
      input: { element: 'Tooltip target button' },
      expectedAction: 'el.hover()',
      expectedSelector: "getByRole('button', { name: \"Tooltip target\" })",
    },
    {
      tool: 'browser_type',
      input: { element: 'Email textbox', text: 'a@b.co' },
      expectedAction: 'el.fill("a@b.co")',
      expectedSelector: "getByRole('textbox', { name: \"Email\" })",
    },
    {
      tool: 'browser_select_option',
      input: { element: 'Plan combobox', values: ['pro'] },
      expectedAction: 'el.selectOption("pro")',
      expectedSelector: "getByRole('combobox', { name: \"Plan\" })",
    },
  ];

  it.each(interactionTools)(
    '$tool emits a block-scoped visibility prelude before $expectedAction',
    async ({ tool, input, expectedAction, expectedSelector }) => {
      const r = await writeSpec({
        devRoot,
        name: 'visible-prelude-' + tool,
        steps: [
          { kind: 'user', text: 'demo' },
          { kind: 'step', tool, input },
          { kind: 'done', summary: 'OK.' },
        ],
      });
      const src = readFileSync(r.path, 'utf-8');
      // The prelude must wrap the interaction in `{ … }`, hoist the locator
      // to a local `el`, assert visibility, then fire the action.
      expect(src).toContain('  {');
      expect(src).toContain(`    const el = page.${expectedSelector};`);
      expect(src).toContain('    await expect(el).toBeVisible();');
      expect(src).toContain(`    await ${expectedAction};`);
      expect(src).toContain('  }');
      // And the prelude must come BEFORE the action — i.e. expect(el).toBeVisible
      // appears earlier in the file than `await el.<action>`.
      const visibleIdx = src.indexOf('await expect(el).toBeVisible()');
      const actionIdx = src.indexOf(`await ${expectedAction}`);
      expect(visibleIdx).toBeGreaterThan(-1);
      expect(actionIdx).toBeGreaterThan(visibleIdx);
    },
  );

  it('does NOT wrap browser_navigate in a prelude (no element targeted)', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'nav-no-prelude',
      steps: [
        { kind: 'user', text: 'just navigate' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
        { kind: 'done', summary: 'OK.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('await page.goto("/");');
    expect(src).not.toContain('toBeVisible');
  });

  it('does NOT wrap browser_press_key in a prelude (page-level keyboard event)', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'press-no-prelude',
      steps: [
        { kind: 'user', text: 'press a key' },
        { kind: 'step', tool: 'browser_press_key', input: { key: 'Enter' } },
        { kind: 'done', summary: 'OK.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('await page.keyboard.press("Enter");');
    expect(src).not.toContain('toBeVisible');
  });

  it('emits one prelude per field of a browser_fill_form step', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'multi-field-prelude',
      steps: [
        { kind: 'user', text: 'fill form' },
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
        { kind: 'done', summary: 'OK.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    // Two preludes — one for each field.
    const visibilityChecks = src.match(/await expect\(el\)\.toBeVisible\(\)/g) ?? [];
    expect(visibilityChecks.length).toBe(2);
    // Each field's fill should appear inside its own block.
    expect(src).toContain('el.fill("a@b.co")');
    expect(src).toContain('el.fill("secret")');
  });

  it('produces well-formed JS — multiple interactions chain without name collisions', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'chained-interactions',
      steps: [
        { kind: 'user', text: 'chain three' },
        { kind: 'step', tool: 'browser_click', input: { element: 'Login button' } },
        { kind: 'step', tool: 'browser_type', input: { element: 'Email textbox', text: 'a' } },
        { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
        { kind: 'done', summary: 'OK.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    // Three preludes; the `const el = …` declarations are block-scoped so
    // they don't shadow each other (no "Identifier 'el' has already been
    // declared" syntax error). Verify by counting the standalone prelude
    // braces inside the test body — the test's own `});` ends with `)`
    // and is not matched by the standalone-`}` pattern.
    const body = src.split('async ({ page }) => {')[1] ?? '';
    const openBraces = body.match(/^\s*\{$/gm) ?? [];
    const closeBraces = body.match(/^\s*\}$/gm) ?? [];
    expect(openBraces.length).toBe(3);
    expect(closeBraces.length).toBe(3);
    // Also assert that each `const el = …` is unique within its block
    // scope — there should be exactly 3 declarations across the body
    // and they should not be reported as redeclarations.
    const elDecls = body.match(/const el =/g) ?? [];
    expect(elDecls.length).toBe(3);
  });
});
