import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSpec, countOptimizableMarkers, OPTIMIZABLE_MARKER } from '../../src/specs/writeSpec.js';
import { writePageObjectManifest } from '../../src/specs/pageObjectManifest.js';
import type { SkillStep } from '../../src/specs/specStep.js';

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

describe('writeSpec — control actuation (check_control)', () => {
  it('crystallizes a check_control step into a deterministic getByRole().check()', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'pick sex',
      steps: [
        { kind: 'user', text: 'select Male' },
        { kind: 'step', tool: 'mcp__hover_control__check_control', input: { role: 'radio', name: 'sex male' } },
        { kind: 'done', summary: 'Selected.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`await page.getByRole("radio", { name: "sex male", exact: true }).check({ force: true })`);
    expect(countOptimizableMarkers(src)).toBe(0); // it IS translatable
  });

  it('emits uncheck() when checked:false', async () => {
    const r = await writeSpec({
      devRoot,
      name: 'clear opt-in',
      steps: [
        { kind: 'user', text: 'clear the box' },
        { kind: 'step', tool: 'mcp__hover_control__check_control', input: { role: 'checkbox', name: 'newsletter', checked: false } },
        { kind: 'done', summary: 'Cleared.' },
      ],
    });
    expect(readFileSync(r.path, 'utf-8')).toContain(`getByRole("checkbox", { name: "newsletter", exact: true }).uncheck({ force: true })`);
  });
});

describe('writeSpec — grounded actuation (click/fill/select_control)', () => {
  // These carry role+name / testId / text straight from the snapshot, so the
  // crystallized selector is grounded — never a confabulated getByText.
  it('click_control with role+name → getByRole().click()', async () => {
    const r = await writeSpec({
      devRoot, name: 'click continue',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Continue' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByRole("button", { name: "Continue", exact: true })`);
    expect(src).toContain('el.click()');
    expect(countOptimizableMarkers(src)).toBe(0);
  });

  it('fill_control → getByRole(textbox).fill(value)', async () => {
    const r = await writeSpec({
      devRoot, name: 'fill email',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'email', value: 'a@b.co' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByRole("textbox", { name: "email", exact: true })`);
    expect(src).toContain(`el.fill("a@b.co")`);
  });

  it('select_control defaults role to combobox from name alone', async () => {
    const r = await writeSpec({
      devRoot, name: 'pick state',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__select_control', input: { name: 'state', value: 'CA' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByRole("combobox", { name: "state", exact: true })`);
    expect(src).toContain(`el.selectOption("CA")`);
  });

  it('upload_file → setInputFiles on the file input (no filechooser; placeholder → committed fixture)', async () => {
    const ph = await writeSpec({
      devRoot, name: 'upload placeholder',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__upload_file', input: { name: 'government id', placeholder: true } },
      ],
    });
    const src = readFileSync(ph.path, 'utf-8');
    expect(src).not.toContain('filechooser');
    expect(src).toContain(`page.getByLabel("government id").setInputFiles("__vibe_tests__/fixtures/hover-placeholder.png")`);

    const real = await writeSpec({
      devRoot, name: 'upload real', overwrite: true,
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__upload_file', input: { path: 'tests/fixtures/id.png' } },
      ],
    });
    // No name/testId → the single file input on the page.
    expect(readFileSync(real.path, 'utf-8')).toContain(`page.locator('input[type="file"]').setInputFiles("tests/fixtures/id.png")`);
  });

  it('click_control with `within` scopes to the group (repeated Yes/No / hidden input)', async () => {
    const r = await writeSpec({
      devRoot, name: 'disclosure no',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { within: { role: 'radiogroup', name: 'pep' }, text: 'No' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByRole("radiogroup", { name: "pep", exact: true }).getByText("No").first()`);
  });

  it('click_control falls back to testId, then text', async () => {
    const byTestId = await writeSpec({
      devRoot, name: 'icon delete',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { testId: 'delete-row' } },
      ],
    });
    expect(readFileSync(byTestId.path, 'utf-8')).toContain(`page.getByTestId("delete-row")`);

    const byText = await writeSpec({
      devRoot, name: 'click link', overwrite: true,
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { text: 'Learn more' } },
      ],
    });
    expect(readFileSync(byText.path, 'utf-8')).toContain(`page.getByText("Learn more").first()`);
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
    const sidecarPath = join(devRoot, '.hover', 'sidecars', `${r.slug}.json`);
    const sc = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
    expect(sc.version).toBe(2);
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
      readFileSync(join(devRoot, '.hover', 'sidecars', `${r.slug}.json`), 'utf-8'),
    );
    expect(sc.assertions).toEqual([{ code: 'expect(x).toBeVisible()', hint: 'visible' }]);
  });

  it('lands under .hover/sidecars/ as .json, outside __vibe_tests__ and never a collectable *.spec.ts', async () => {
    const r = await writeSpec({ devRoot, name: 'guard', steps: session });
    const sidecarPath = join(devRoot, '.hover', 'sidecars', `${r.slug}.json`);
    // readFileSync throws if absent — proves it was written.
    expect(readFileSync(sidecarPath, 'utf-8').length).toBeGreaterThan(0);
    expect(sidecarPath.endsWith('.spec.ts')).toBe(false);
    // The specs dir stays 100% user code — no Hover-internal files inside it.
    expect(sidecarPath).not.toContain('__vibe_tests__');
    expect(sidecarPath).toContain(join('.hover', 'sidecars'));
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
    expect(src).toContain("import { test, expect } from '../fixtures';");
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

describe('writeSpec — credential redaction', () => {
  const loginSession: SkillStep[] = [
    { kind: 'user', text: 'log in as the paid user' },
    { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
    {
      kind: 'step',
      tool: 'browser_fill_form',
      input: {
        fields: [
          { name: 'email', type: 'textbox', value: 'paid@example.com' },
          { name: 'password', type: 'textbox', value: 'hunter2-secret' },
        ],
      },
    },
    { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
    { kind: 'done', turns: 3, costUsd: 0.01, summary: 'Logged in.' },
  ];
  const redactions = [
    { value: 'paid@example.com', envVar: 'HOVER_AUSER_USER' },
    { value: 'hunter2-secret', envVar: 'HOVER_AUSER_PASS' },
  ];

  it('parameterizes matched fill values into process.env and never writes the secret', async () => {
    const r = await writeSpec({ devRoot, name: 'login paid', steps: loginSession, redactions });
    const spec = readFileSync(r.path, 'utf-8');
    // This session is a pure login → auth-fixture lifts it into auth.setup.ts
    // (fresh devRoot has no playwright.config, so the fixture auto-engages).
    const setup = readFileSync(join(devRoot, '__vibe_tests__', 'auth.setup.ts'), 'utf-8');
    // Credentials are emitted as code (process.env), in the setup project.
    expect(setup).toContain("process.env.HOVER_AUSER_PASS ?? ''");
    expect(setup).toContain("process.env.HOVER_AUSER_USER ?? ''");
    // The spec reuses the saved session instead of logging in inline.
    expect(spec).toContain('test.use({ storageState:');
    // The secret appears NOWHERE — neither file, code nor prose.
    for (const src of [spec, setup]) {
      expect(src).not.toContain('hunter2-secret');
      expect(src).not.toContain('paid@example.com');
    }
  });

  it('keeps the secret out of the .hover sidecar too', async () => {
    const r = await writeSpec({ devRoot, name: 'login paid', steps: loginSession, redactions });
    const sidecar = readFileSync(join(devRoot, '.hover', 'sidecars', `${r.slug}.json`), 'utf-8');
    expect(sidecar).not.toContain('hunter2-secret');
    expect(sidecar).toContain('process.env.HOVER_AUSER_PASS');
  });

  it('is a no-op when no redactions are supplied', async () => {
    const r = await writeSpec({ devRoot, name: 'login plain', steps: loginSession });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('hunter2-secret');
    expect(src).not.toContain('process.env.HOVER_AUSER_PASS');
  });
});

describe('writeSpec — hyphenated Hover-MCP tool names (bug B)', () => {
  // The MCP servers are kebab-case (`hover-control`, `hover-source`); the
  // prefix-strip regex must include `-` or every Hover-MCP step silently
  // degrades to an optimizable marker instead of a real Playwright call.
  it('translates mcp__hover-control__check_control into a check() step, not a marker', async () => {
    const steps: SkillStep[] = [
      { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
      { kind: 'step', tool: 'mcp__hover-control__check_control', input: { role: 'radio', name: 'sex male' } },
    ];
    const r = await writeSpec({ devRoot, name: 'radio check', steps });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`getByRole("radio", { name: "sex male", exact: true }).check({ force: true })`);
    expect(countOptimizableMarkers(src)).toBe(0);
    expect(src).not.toContain(OPTIMIZABLE_MARKER);
  });

  it('strips the hyphenated prefix even for a tool that falls to a marker', async () => {
    const steps: SkillStep[] = [
      { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
      // A hyphenated Hover-MCP tool with no single-step translation that is NOT
      // exploratory (so it isn't dropped): the prefix must still be stripped.
      { kind: 'step', tool: 'mcp__hover-control__drag_control', input: {} },
    ];
    const r = await writeSpec({ devRoot, name: 'drag control', steps });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`${OPTIMIZABLE_MARKER}: drag_control`);
    const markerLine = src.split('\n').find(l => l.includes(OPTIMIZABLE_MARKER));
    expect(markerLine).not.toContain('mcp__hover-control__');
  });
});

describe('writeSpec — dirty-recording cleanup', () => {
  // The agent explores: it makes failed attempts (isError) and reads source to
  // orient itself. Those are captured but must NOT pollute the runnable spec.
  const dirtySession: SkillStep[] = [
    { kind: 'user', text: 'select female then continue' },
    { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
    // Agent flails at a radio: two failed clicks on labels that don't exist…
    { kind: 'step', tool: 'browser_click', input: { element: 'sex female label' }, isError: true },
    { kind: 'step', tool: 'browser_click', input: { element: 'Female pill wrapper' }, isError: true },
    // …reads the component source to understand it…
    { kind: 'step', tool: 'mcp__hover-source__read_source', input: { path: 'src/form.tsx' } },
    // …then succeeds via the control-actuation tool.
    { kind: 'step', tool: 'mcp__hover-control__check_control', input: { role: 'radio', name: 'Female' } },
    { kind: 'step', tool: 'browser_click', input: { element: 'Continue button' } },
    { kind: 'done', summary: 'Selected Female and continued.' },
  ];

  it('drops errored steps and source reads from the runnable body', async () => {
    const r = await writeSpec({ devRoot, name: 'clean flow', steps: dirtySession });
    const src = readFileSync(r.path, 'utf-8');
    // Kept: the working actions.
    expect(src).toContain(`getByRole("radio", { name: "Female", exact: true }).check({ force: true })`);
    expect(src).toContain(`getByRole('button', { name: "Continue" })`);
    // Dropped: the failed flailing and the source read.
    expect(src).not.toContain('sex female label');
    expect(src).not.toContain('Female pill wrapper');
    expect(src).not.toContain('read_source');
    expect(countOptimizableMarkers(src)).toBe(0);
  });

  it('notes how many steps were omitted in the JSDoc header', async () => {
    const r = await writeSpec({ devRoot, name: 'clean flow', steps: dirtySession });
    const src = readFileSync(r.path, 'utf-8');
    // 2 errored clicks + 1 source read = 3 omitted.
    expect(src).toContain('3 exploratory/failed steps from the session');
  });

  it('keeps the full unfiltered capture (errors included) in the sidecar', async () => {
    const r = await writeSpec({ devRoot, name: 'clean flow', steps: dirtySession });
    const sidecar = readFileSync(join(devRoot, '.hover', 'sidecars', `${r.slug}.json`), 'utf-8');
    // Sidecar is the full-fidelity record for re-record / optimize.
    expect(sidecar).toContain('sex female label');
    expect(sidecar).toContain('read_source');
    expect(sidecar).toContain('"isError": true');
  });

  it('adds no omission note when the session is clean', async () => {
    const r = await writeSpec({ devRoot, name: 'login + counter', steps: session });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).not.toContain('omitted from this runnable flow');
  });
});

describe('writeSpec — guarantees the spec opens the app', () => {
  // The agent often connects to an already-open debug-Chrome tab and never
  // calls browser_navigate, so the recording can lack any navigation. Without
  // a synthesized goto the spec runs against about:blank and every locator
  // fails — exactly the "saved spec won't run" report.
  const noNavSession: SkillStep[] = [
    { kind: 'user', text: 'click continue' },
    { kind: 'step', tool: 'browser_click', input: { element: 'Continue button' } },
  ];

  it('synthesizes a leading page.goto() from startUrl when no navigation was captured', async () => {
    const r = await writeSpec({ devRoot, name: 'no nav', steps: noNavSession, startUrl: 'http://localhost:5175/' });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('await page.goto("/");');
    // The goto comes first, before the click.
    expect(src.indexOf('page.goto')).toBeLessThan(src.indexOf("getByRole('button', { name: \"Continue\" })"));
  });

  it('does NOT add a goto when the session already navigated', async () => {
    const r = await writeSpec({ devRoot, name: 'has nav', steps: session, startUrl: 'http://localhost:9999/' });
    const src = readFileSync(r.path, 'utf-8');
    // Exactly one goto — the captured one, not a synthesized duplicate.
    expect(src.match(/page\.goto/g)?.length).toBe(1);
    expect(src).not.toContain('localhost:9999');
  });

  it('omits the goto when no navigation and no startUrl is available', async () => {
    const r = await writeSpec({ devRoot, name: 'no nav no url', steps: noNavSession });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).not.toContain('page.goto');
  });
});

describe('writeSpec — select targets the combobox, not the label text', () => {
  it('emits getByRole(combobox) for browser_select_option, never getByText', async () => {
    const steps: SkillStep[] = [
      { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5175/' } },
      { kind: 'step', tool: 'browser_select_option', input: { element: 'marital status', values: ['Single'] } },
    ];
    const r = await writeSpec({ devRoot, name: 'select', steps });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByRole('combobox', { name: "marital status" })`);
    expect(src).toContain(`el.selectOption("Single")`);
    expect(src).not.toContain('getByText("marital status")');
  });
});

describe('writeSpec — Playwright config scaffolding (bug A)', () => {
  // Specs use relative URLs; a project with no config has no baseURL, so
  // `page.goto("/")` throws "Cannot navigate to invalid URL". writeSpec must
  // scaffold a config (baseURL from the first navigation) when none exists.
  it('scaffolds playwright.config.ts with baseURL from the first navigation', async () => {
    await writeSpec({ devRoot, name: 'login + counter', steps: session });
    const cfg = readFileSync(join(devRoot, 'playwright.config.ts'), 'utf-8');
    expect(cfg).toContain(`baseURL: process.env.HOVER_BASE_URL ?? "http://localhost:5173"`);
    expect(cfg).toContain(`testDir: './__vibe_tests__'`);
  });

  it('never overwrites an existing config', async () => {
    const existing = join(devRoot, 'playwright.config.ts');
    writeFileSync(existing, '// user-owned config\n');
    await writeSpec({ devRoot, name: 'login + counter', steps: session });
    expect(readFileSync(existing, 'utf-8')).toBe('// user-owned config\n');
  });

  it('skips scaffolding when no navigation origin can be inferred', async () => {
    const steps: SkillStep[] = [
      { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
    ];
    await writeSpec({ devRoot, name: 'no nav', steps });
    expect(existsSync(join(devRoot, 'playwright.config.ts'))).toBe(false);
  });
});

describe('writeSpec — reset helper (debt-2 reproducible state)', () => {
  const nav = { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5176/' } } as const;
  const click = { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Flip' } } as const;

  it('tier-1 recipe → generates support/resetState.ts + beforeEach call', async () => {
    const r = await writeSpec({
      devRoot, name: 'flip with reset',
      steps: [nav, click],
      resetRecipe: { tier: 1 },
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`import { resetState } from '../support/resetState'`);
    expect(src).toContain('test.beforeEach(async ({ page, context }) => {');
    expect(src).toContain('await resetState(page, context);');
    const helper = readFileSync(join(devRoot, '__vibe_tests__', 'support', 'resetState.ts'), 'utf-8');
    expect(helper).toContain('export async function resetState');
    expect(helper).toContain("await page.goto('/')"); // goto before clearing (per-origin storage)
    expect(helper).toContain('localStorage.clear()');
    expect(helper).toContain('const KEYS: string[] = []');
  });

  it('tier-1 with storageKeys → bakes the scoped keys into the helper', async () => {
    const r = await writeSpec({
      devRoot, name: 'flip scoped reset',
      steps: [nav, click],
      resetRecipe: { tier: 1, storageKeys: ['progress', 'daily_tasks'] },
    });
    const helper = readFileSync(join(devRoot, '__vibe_tests__', 'support', 'resetState.ts'), 'utf-8');
    expect(helper).toContain('const KEYS: string[] = ["progress","daily_tasks"]');
    expect(readFileSync(r.path, 'utf-8')).toContain('await resetState(page, context);');
  });

  it('tier-2 recipe → NO reset emitted, NO helper file', async () => {
    const r = await writeSpec({
      devRoot, name: 'no reset tier2',
      steps: [nav, click],
      resetRecipe: { tier: 2 },
    });
    expect(readFileSync(r.path, 'utf-8')).not.toContain('resetState');
    expect(existsSync(join(devRoot, '__vibe_tests__', 'support', 'resetState.ts'))).toBe(false);
  });

  it('no recipe → unchanged (no reset)', async () => {
    const r = await writeSpec({ devRoot, name: 'no recipe', steps: [nav, click] });
    expect(readFileSync(r.path, 'utf-8')).not.toContain('resetState');
  });
});

describe('writeSpec — dynamic content (invariant vs instance)', () => {
  // A flag the agent sets when name/text is page CONTENT that varies run-to-run
  // (a drawn flashcard word). The anchor must NOT freeze the literal.
  it('dynamic click_control anchors on role, not the volatile name', async () => {
    const r = await writeSpec({
      devRoot, name: 'flip card',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5176/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'apple', dynamic: true } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByRole("button").first()`);
    expect(src).not.toContain('"apple"');
  });

  it('dynamic prefers testId over the volatile name', async () => {
    const r = await writeSpec({
      devRoot, name: 'flip card by testid',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5176/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'banana', testId: 'flip', dynamic: true } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`page.getByTestId("flip")`);
    expect(src).not.toContain('"banana"');
  });

  it('non-dynamic name is unchanged (still exact)', async () => {
    const r = await writeSpec({
      devRoot, name: 'click submit',
      steps: [
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5176/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Submit' } },
      ],
    });
    expect(readFileSync(r.path, 'utf-8')).toContain(`page.getByRole("button", { name: "Submit", exact: true })`);
  });
});

describe('writeSpec — assert_visible crystallization', () => {
  const nav = { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5176/' } } as const;

  it('dynamic word → non-empty invariant, not the literal', async () => {
    const r = await writeSpec({
      devRoot, name: 'a word is shown',
      steps: [
        nav,
        { kind: 'step', tool: 'mcp__hover-control__assert_visible',
          input: { testId: 'word', matcher: 'non-empty', dynamic: true, observed: 'apple' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`expect(page.getByTestId("word").first()).not.toHaveText('')`);
    expect(src).not.toContain('"apple"');
  });

  it('dynamic downgrades a text-exact request to non-empty (never freezes the value)', async () => {
    const r = await writeSpec({
      devRoot, name: 'word exact guard',
      steps: [
        nav,
        { kind: 'step', tool: 'mcp__hover-control__assert_visible',
          input: { testId: 'word', matcher: 'text-exact', dynamic: true, observed: 'cherry' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain(`.not.toHaveText('')`);
    expect(src).not.toContain('"cherry"');
  });

  it('text-exact on fixed text keeps the literal', async () => {
    const r = await writeSpec({
      devRoot, name: 'heading',
      steps: [
        nav,
        { kind: 'step', tool: 'mcp__hover-control__assert_visible',
          input: { role: 'heading', name: 'Welcome', matcher: 'text-exact', expected: 'Welcome' } },
      ],
    });
    expect(readFileSync(r.path, 'utf-8')).toContain(`.toHaveText("Welcome")`);
  });

  it('count matcher → toHaveCount', async () => {
    const r = await writeSpec({
      devRoot, name: 'three cards',
      steps: [
        nav,
        { kind: 'step', tool: 'mcp__hover-control__assert_visible',
          input: { role: 'listitem', matcher: 'count', count: 3 } },
      ],
    });
    expect(readFileSync(r.path, 'utf-8')).toContain(`.toHaveCount(3)`);
  });

  it('default matcher → toBeVisible', async () => {
    const r = await writeSpec({
      devRoot, name: 'greeting visible',
      steps: [
        nav,
        { kind: 'step', tool: 'mcp__hover-control__assert_visible', input: { testId: 'greeting' } },
      ],
    });
    expect(readFileSync(r.path, 'utf-8')).toContain(`expect(page.getByTestId("greeting").first()).toBeVisible()`);
  });

  it('text-anchored assert_visible does not double .first()', async () => {
    const r = await writeSpec({
      devRoot, name: 'instruction visible',
      steps: [
        nav,
        { kind: 'step', tool: 'mcp__hover-control__assert_visible', input: { text: 'Press space to flip' } },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).toContain('.first())');
    expect(src).not.toContain('.first().first()');
  });
});

describe('writeSpec — auth-as-fixture (debt 3)', () => {
  const creds = [
    { value: 'paid@example.com', envVar: 'HOVER_USER' },
    { value: 'pw-secret-xyz', envVar: 'HOVER_PASS' },
  ];
  // navigate → fill email → fill password → submit → THEN a business step.
  const loginThenBuy: SkillStep[] = [
    { kind: 'user', text: 'log in and add to cart' },
    { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
    { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'Email', value: 'paid@example.com' } },
    { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'Password', value: 'pw-secret-xyz' } },
    { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Sign in' } },
    { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Add to cart' } },
    { kind: 'done', summary: 'Added to cart.' },
  ];
  const setupPath = () => join(devRoot, '__vibe_tests__', 'auth.setup.ts');

  it('lifts login into auth.setup.ts and the spec starts authenticated', async () => {
    const r = await writeSpec({ devRoot, name: 'buy', steps: loginThenBuy, redactions: creds });
    const spec = readFileSync(r.path, 'utf-8');
    const setup = readFileSync(setupPath(), 'utf-8');
    // setup.ts replays login (redacted) + saves storageState, with `expect`
    // imported and each step block-scoped so the per-step `const el` never collides.
    expect(setup).toContain("import { test as setup, expect } from '@playwright/test'");
    expect(setup).toContain('getByRole("textbox", { name: "Password", exact: true })');
    expect(setup).toContain("el.fill(process.env.HOVER_PASS ?? '')");
    expect(setup).toContain('context.storageState({ path:');
    expect(setup).toContain('  {'); // block-scoping present
    // The spec drops the login, reuses the session, keeps the business step, and
    // still navigates (the login's goto was lifted, so it synthesizes its own).
    expect(spec).toContain('test.use({ storageState:');
    expect(spec).toContain('page.goto(');
    expect(spec).toContain('getByRole("button", { name: "Add to cart", exact: true })');
    expect(spec).not.toContain('Sign in');
    expect(spec).not.toContain('Password');
  });

  it('registers a setup project in the scaffolded playwright.config', async () => {
    await writeSpec({ devRoot, name: 'buy', steps: loginThenBuy, redactions: creds });
    const cfg = readFileSync(join(devRoot, 'playwright.config.ts'), 'utf-8');
    expect(cfg).toContain("name: 'setup'");
    expect(cfg).toContain("dependencies: ['setup']");
  });

  it('does NOT engage when a user playwright.config already exists (login stays inline)', async () => {
    writeFileSync(join(devRoot, 'playwright.config.ts'), 'export default {};');
    const r = await writeSpec({ devRoot, name: 'buy', steps: loginThenBuy, redactions: creds });
    const spec = readFileSync(r.path, 'utf-8');
    expect(existsSync(setupPath())).toBe(false);
    expect(spec).not.toContain('test.use({ storageState:');
    // login is still inline in the spec
    expect(spec).toContain('getByRole("button", { name: "Sign in", exact: true })');
  });

  it('is inert without redactions (no credentials → no auth prefix)', async () => {
    const r = await writeSpec({ devRoot, name: 'buy', steps: loginThenBuy });
    expect(existsSync(setupPath())).toBe(false);
    expect(readFileSync(r.path, 'utf-8')).not.toContain('test.use({ storageState:');
  });
});

describe('writeSpec — auth-fixture w/ existing config (Stage 4b core)', () => {
  const creds = [
    { value: 'paid@example.com', envVar: 'HOVER_USER' },
    { value: 'pw-secret-xyz', envVar: 'HOVER_PASS' },
  ];
  const login: SkillStep[] = [
    { kind: 'user', text: 'log in' },
    { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
    { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'Email', value: 'paid@example.com' } },
    { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'Password', value: 'pw-secret-xyz' } },
    { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Sign in' } },
    { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Add to cart' } },
    { kind: 'done', summary: 'done' },
  ];
  const scaffoldedConfig = [
    "import { defineConfig } from '@playwright/test';",
    "export default defineConfig({ testDir: './__vibe_tests__', use: { baseURL: 'http://x' } });",
  ].join('\n');
  const setupPath = () => join(devRoot, '__vibe_tests__', 'auth.setup.ts');

  it('without approval: keeps login inline + returns the proposed config edit as an offer', async () => {
    writeFileSync(join(devRoot, 'playwright.config.ts'), scaffoldedConfig);
    const r = await writeSpec({ devRoot, name: 'buy', steps: login, redactions: creds });
    expect(existsSync(setupPath())).toBe(false);                // not engaged
    expect(readFileSync(r.path, 'utf-8')).not.toContain('test.use({ storageState:');
    // The offer carries the AST-edited config for the approval UI to preview.
    expect(r.authFixtureOffer?.configPath).toContain('playwright.config.ts');
    expect(r.authFixtureOffer?.proposedConfig).toContain("name: 'setup'");
  });

  it('with approval (authFixture:true): engages + applies the config edit', async () => {
    writeFileSync(join(devRoot, 'playwright.config.ts'), scaffoldedConfig);
    const r = await writeSpec({ devRoot, name: 'buy', steps: login, redactions: creds, authFixture: true, overwrite: true });
    // Spec slimmed + auth.setup.ts written.
    expect(existsSync(setupPath())).toBe(true);
    expect(readFileSync(r.path, 'utf-8')).toContain('test.use({ storageState:');
    // The USER's config now has the setup project applied.
    const cfg = readFileSync(join(devRoot, 'playwright.config.ts'), 'utf-8');
    expect(cfg).toContain("name: 'setup'");
    expect(cfg).toContain("dependencies: ['setup']");
    // And the original config content is preserved.
    expect(cfg).toContain("testDir: './__vibe_tests__'");
    // No offer once engaged.
    expect(r.authFixtureOffer).toBeUndefined();
  });

  it('no offer when the config already has projects (cannot safely edit)', async () => {
    writeFileSync(join(devRoot, 'playwright.config.ts'),
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ projects: [{ name: 'x' }] });");
    const r = await writeSpec({ devRoot, name: 'buy', steps: login, redactions: creds });
    expect(r.authFixtureOffer).toBeUndefined();
  });
});

describe('writeSpec — QA marker + JSDoc cleanup (flow-3 bugs)', () => {
  it('drops record_candidate (QA capture signal) — no junk optimizable step in the spec', async () => {
    const r = await writeSpec({
      devRoot, name: 'learn',
      steps: [
        { kind: 'user', text: 'learn words' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5178/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: '认识' } },
        { kind: 'step', tool: 'mcp__hover-control__record_candidate', input: { name: 'Learn words' } },
        { kind: 'done', summary: 'Done.' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    expect(src).not.toContain('record_candidate');
    expect(countOptimizableMarkers(src)).toBe(0);
    // The real action is still there.
    expect(src).toContain('getByRole("button", { name: "认识", exact: true })');
  });

  it('keeps a multi-line CJK summary from breaking the JSDoc block', async () => {
    const r = await writeSpec({
      devRoot, name: 'cjk',
      steps: [
        { kind: 'user', text: '学习' },
        { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5178/' } },
        { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: '认识' } },
        { kind: 'done', summary: '已成功登录并学完今天的全部单词。\n\n- 用测试账户登录\n- 调高每日目标\n- 学完 5 个新词' },
      ],
    });
    const src = readFileSync(r.path, 'utf-8');
    const jsdoc = src.split("test('")[0].split('/**')[1];
    // EVERY non-empty line inside the JSDoc must stay prefixed with ` *`.
    for (const line of jsdoc.split('\n')) {
      if (line.trim() === '') continue;
      expect(line.startsWith(' *')).toBe(true);
    }
    // Expected shows only the lead sentence, not the bullet body.
    expect(src).toContain(' *   • 已成功登录并学完今天的全部单词。');
    expect(src).not.toContain(' *   • 已成功登录并学完今天的全部单词。\n- 用测试账户登录');
  });
});

describe('writeSpec — auth-fixture auto-engages once set up (flow-5 gap)', () => {
  const creds = [
    { value: 'paid@example.com', envVar: 'HOVER_USER' },
    { value: 'pw-secret-xyz', envVar: 'HOVER_PASS' },
  ];
  const login: SkillStep[] = [
    { kind: 'user', text: '登录并学习' },
    { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
    { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'Email', value: 'paid@example.com' } },
    { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'Password', value: 'pw-secret-xyz' } },
    { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Sign in' } },
    { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Start' } },
    { kind: 'done', summary: 'done' },
  ];

  it('engages WITHOUT re-approval when auth.setup.ts already exists', async () => {
    // Simulate a prior approval: config has projects + auth.setup.ts present.
    writeFileSync(join(devRoot, 'playwright.config.ts'),
      "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ projects: [{ name: 'setup' }] });");
    const setupDir = join(devRoot, '__vibe_tests__');
    require('node:fs').mkdirSync(setupDir, { recursive: true });
    writeFileSync(join(setupDir, 'auth.setup.ts'), '// existing setup');

    const r = await writeSpec({ devRoot, name: 'flow5', steps: login, redactions: creds });
    const spec = readFileSync(r.path, 'utf-8');
    // Auto-engaged: login lifted, session reused — no re-offer needed.
    expect(spec).toContain('test.use({ storageState:');
    expect(spec).not.toContain('Sign in');
    expect(r.authFixtureOffer).toBeUndefined();
  });
});
