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
