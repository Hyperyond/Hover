import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSpec, countOptimizableMarkers, OPTIMIZABLE_MARKER } from '../../src/specs/writeSpec.js';
import { writePageObjectManifest } from '../../src/specs/pageObjectManifest.js';
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

describe('writeSpec — optimizable markers', () => {
  it('leaves a hover:optimizable marker (not a TODO) for an action with no single-step translation', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'upload flow',
      steps: [
        { kind: 'user', text: 'upload a file' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
        { kind: 'step', tool: 'browser_file_upload', input: { paths: ['/tmp/a.pdf'] } },
        { kind: 'done', summary: 'Uploaded.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(OPTIMIZABLE_MARKER);
    expect(src).toContain('browser_file_upload');
    expect(src).not.toContain('// TODO');
    expect(countOptimizableMarkers(src)).toBe(1);
  });

  it('emits no marker for a fully-translatable session', async () => {
    const r = await writeSpec({ devRoot, name: 'clean', steps: session });
    expect(countOptimizableMarkers(readFileSync(r.path, 'utf-8'))).toBe(0);
  });
});

describe('countOptimizableMarkers', () => {
  it('counts marker lines, ignoring the same text inside a string literal', () => {
    const src = [
      `${OPTIMIZABLE_MARKER}: browser_drag — ...`,
      `  ${OPTIMIZABLE_MARKER}: browser_handle_dialog — ...`,
      `await page.fill('${OPTIMIZABLE_MARKER}');`, // not at line start → not a marker
    ].join('\n');
    expect(countOptimizableMarkers(src)).toBe(2);
  });

  it('returns 0 for an empty or marker-free spec', () => {
    expect(countOptimizableMarkers('')).toBe(0);
    expect(countOptimizableMarkers('await page.goto("/");')).toBe(0);
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
      // Each interaction is wrapped in its own test.step closure (which scopes
      // `el`), then runs the visibility-guarded prelude inside it.
      expect(src).toContain('await test.step(');
      expect(src).toContain(`    const el = page.${expectedSelector};`);
      expect(src).toContain('    await expect(el).toBeVisible();');
      expect(src).toContain(`    await ${expectedAction};`);
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
    // Three interactions → three test.step closures. Each closure scopes its
    // own `el`, so the three `const el = …` declarations don't shadow each
    // other (no "Identifier 'el' has already been declared" syntax error).
    const body = src.split('async ({ page }) => {')[1] ?? '';
    const stepWrappers = body.match(/await test\.step\(/g) ?? [];
    expect(stepWrappers.length).toBe(3);
    const elDecls = body.match(/const el =/g) ?? [];
    expect(elDecls.length).toBe(3);
  });
});

describe('writeSpec — test.step Given/When/Then wrapping (F1)', () => {
  it('wraps each captured step in a test.step labelled with the humanStep prose', async () => {
    const r = await writeSpec({ devRoot, name: 'f1-wrap', steps: session });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('await test.step("Given · Open http://localhost:5173/", async () => {');
    expect(src).toContain('await test.step("When · Click Submit button", async () => {');
  });

  it('labels leading navigation Given and the first interaction When', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'f1-phases',
      steps: [
        { kind: 'user', text: 'x' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
        { kind: 'step', tool: 'browser_click', input: { element: 'Go button' } },
        { kind: 'done', summary: 'ok' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('test.step("Given · Open');
    expect(src).toContain('test.step("When · Click Go button"');
  });

  it('wraps Alt-click assertions as Then steps', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'f1-then',
      steps: session,
      assertions: [
        { code: 'expect(page.getByText("3")).toBeVisible()', hint: 'counter reads 3' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('await test.step("Then · counter reads 3", async () => {');
    expect(src).toContain('await expect(page.getByText("3")).toBeVisible();');
  });
});

describe('writeSpec — structured sidecar (Stage 1)', () => {
  it('writes a .hover/<slug>.json sidecar with the verbatim structured session', async () => {
    const r = await writeSpec({ devRoot, name: 'login + counter', steps: session });
    const sidecarPath = join(devRoot, '__vibe_tests__', '.hover', `${r.slug}.json`);
    const sc = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
    expect(sc.version).toBe(1);
    expect(sc.slug).toBe(r.slug);
    expect(sc.name).toBe('login + counter');
    expect(typeof sc.createdAt).toBe('string');
    // The full structured steps are preserved verbatim, not re-parsed from
    // the generated .spec.ts — this is the record F4 / F7 read.
    expect(sc.steps).toEqual(session);
    expect(sc.assertions).toEqual([]);
  });

  it('persists Alt-click assertions in the sidecar', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'with asserts',
      steps: session,
      assertions: [{ code: 'expect(x).toBeVisible()', hint: 'visible' }],
    });
    const sc = JSON.parse(
      readFileSync(join(devRoot, '__vibe_tests__', '.hover', `${r.slug}.json`), 'utf-8'),
    );
    expect(sc.assertions).toEqual([{ code: 'expect(x).toBeVisible()', hint: 'visible' }]);
  });

  it('lands in a dot-prefixed .hover/ dir as .json, never a collectable *.spec.ts', async () => {
    const r = await writeSpec({ devRoot, name: 'guard', steps: session });
    const sidecarPath = join(devRoot, '__vibe_tests__', '.hover', `${r.slug}.json`);
    // readFileSync throws if absent — proves it was written.
    expect(readFileSync(sidecarPath, 'utf-8').length).toBeGreaterThan(0);
    expect(sidecarPath.endsWith('.spec.ts')).toBe(false);
    expect(sidecarPath).toContain(`${join('__vibe_tests__', '.hover')}`);
  });
});

describe('writeSpec — Page Object consumption (Stage 3c)', () => {
  const manifestEntry = {
    className: 'LoginPage',
    methodName: 'login',
    fixtureName: 'loginPage',
    fileName: 'LoginPage.ts',
    signatures: ['navigate:/login', 'fill:Email,Password', 'click:Sign in button'],
    specs: ['x', 'y', 'z'],
  };
  const consuming: SkillStep[] = [
    { kind: 'user', text: 'log in then add a todo' },
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
    { kind: 'step', tool: 'browser_click', input: { element: 'Add todo button' } },
    { kind: 'done', summary: 'ok' },
  ];

  it('folds a matching prefix into one Page Object call and imports fixtures', async () => {
    await writePageObjectManifest(devRoot, [manifestEntry]);
    const r = await writeSpec({ devRoot, name: 'login + add todo', steps: consuming });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain("import { test, expect } from './fixtures';");
    expect(src).toContain("test('login + add todo', async ({ page, loginPage }) => {");
    expect(src).toContain('await loginPage.login("a@b.co", "secret");');
    // The consumed prefix is NOT re-emitted inline…
    expect(src).not.toContain('getByRole(\'textbox\', { name: "Email" })');
    // …but the tail step after the prefix still renders normally.
    expect(src).toContain('When · Click Add todo button');
    expect(src).toContain('await el.click();');
  });

  it('leaves the spec as plain @playwright/test when no Page Object matches', async () => {
    await writePageObjectManifest(devRoot, [manifestEntry]);
    const r = await writeSpec({
      devRoot,
      name: 'unrelated',
      steps: [
        { kind: 'user', text: 'x' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/dashboard' } },
        { kind: 'step', tool: 'browser_click', input: { element: 'Export button' } },
        { kind: 'done', summary: 'ok' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain("import { test, expect } from '@playwright/test';");
    expect(src).toContain('async ({ page }) => {');
    expect(src).not.toContain('loginPage');
  });
});

describe('writeSpec — popup / new-tab pairing (F6)', () => {
  const payFlow: SkillStep[] = [
    { kind: 'user', text: 'pay with payhover' },
    { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/checkout' } },
    { kind: 'step', tool: 'browser_click', input: { element: 'Pay with PayHover button' } },
    { kind: 'step', tool: 'browser_tabs', input: { action: 'select', idx: 1 } },
    { kind: 'step', tool: 'browser_click', input: { element: 'Confirm payment button' } },
    { kind: 'step', tool: 'browser_tabs', input: { action: 'select', idx: 0 } },
    { kind: 'step', tool: 'browser_click', input: { element: 'View receipt button' } },
    { kind: 'done', summary: 'ok' },
  ];

  it('pairs click + tab-switch into Promise.all and re-targets the new tab', async () => {
    const r = await writeSpec({ devRoot, name: 'pay with payhover', steps: payFlow });
    const src = readFileSync(r.path, 'utf-8');
    // signature widened to include the context fixture
    expect(src).toContain('async ({ context, page }) => {');
    // opener click is paired with waitForEvent — no visibility prelude on it
    expect(src).toContain('const [newPage] = await Promise.all([');
    expect(src).toContain("context.waitForEvent('page'),");
    expect(src).toContain('page.getByRole(\'button\', { name: "Pay with PayHover" }).click(),');
    // the step after the switch operates the NEW tab
    expect(src).toContain('const el = newPage.getByRole(\'button\', { name: "Confirm payment" });');
    // after switching back to idx 0, steps operate the ORIGINAL page again
    expect(src).toContain('const el = page.getByRole(\'button\', { name: "View receipt" });');
  });

  it('leaves single-tab specs with a plain { page } signature (no context)', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'no popup',
      steps: [
        { kind: 'user', text: 'x' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
        { kind: 'step', tool: 'browser_click', input: { element: 'Go button' } },
        { kind: 'done', summary: 'ok' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('async ({ page }) => {');
    expect(src).not.toContain('context');
    expect(src).not.toContain('Promise.all');
  });
});
