import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCaseCsv, CaseCsvExistsError } from '../../src/specs/writeCaseCsv.js';
import type { SkillStep } from '../../src/skills/writeSkill.js';

let devRoot: string;

beforeEach(() => {
  devRoot = mkdtempSync(join(tmpdir(), 'hover-case-csv-'));
});

afterEach(() => {
  rmSync(devRoot, { recursive: true, force: true });
});

/** Parse a CSV string into a 2D array (very simple — handles our own
 *  RFC 4180 output: quoted fields, doubled-quote escaping, CRLF rows). */
function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuotes = false; continue; }
      field += c; continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const sampleSteps: SkillStep[] = [
  { kind: 'user', text: 'log in then add a todo' },
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/' } },
  { kind: 'step', tool: 'browser_type', input: { element: 'Email', text: 'a@b.co' } },
  { kind: 'step', tool: 'browser_click', input: { element: 'Submit button' } },
  {
    kind: 'done',
    turns: 4,
    costUsd: 0.012,
    summary: 'Logged in. Todo "verify hover" added.',
  },
];

describe('writeCaseCsv', () => {
  it('writes <slug>.case.csv under __vibe_tests__', async () => {
    const r = await writeCaseCsv({ devRoot, name: 'Login Flow', steps: sampleSteps });
    expect(r.slug).toBe('login-flow');
    expect(r.path).toContain('__vibe_tests__/login-flow.case.csv');
    const csv = readFileSync(r.path, 'utf-8');
    expect(csv).toContain('Issue Id,Summary,Test Type');
  });

  it('emits a multi-row layout — first row carries case-level fields, rest carry only Action', async () => {
    const r = await writeCaseCsv({ devRoot, name: 'Login Flow', steps: sampleSteps });
    const rows = parseCsv(readFileSync(r.path, 'utf-8'));
    // header + 3 action rows
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(['Issue Id', 'Summary', 'Test Type', 'Priority', 'Labels', 'Action', 'Expected Result']);
    // First action row has the case-level fields populated.
    expect(rows[1][0]).toBe('login-flow');
    expect(rows[1][1]).toBe('Login Flow');
    expect(rows[1][2]).toBe('Manual');
    expect(rows[1][3]).toBe('Medium');
    expect(rows[1][5]).toBe('Open http://localhost:5173/');
    // Second action row has empty case-level fields, populated Action only.
    expect(rows[2][0]).toBe('login-flow');
    expect(rows[2][1]).toBe('');
    expect(rows[2][5]).toBe('Type "a@b.co" into Email');
    // Last row carries the Expected Result.
    expect(rows[3][6]).toBe('Logged in.');
  });

  it('promotes assertion hints to the Expected Result when present', async () => {
    const r = await writeCaseCsv({
      devRoot,
      name: 'Login Flow',
      steps: sampleSteps,
      assertions: [
        { code: 'expect(SEL).toHaveText("Welcome")', hint: 'welcome heading visible' },
        { code: 'expect(SEL).toBeChecked()', hint: 'remember-me checked' },
      ],
    });
    const rows = parseCsv(readFileSync(r.path, 'utf-8'));
    const expectedCell = rows[rows.length - 1][6];
    expect(expectedCell).toContain('• welcome heading visible');
    expect(expectedCell).toContain('• remember-me checked');
  });

  it('includes the Jira project key and user labels in the Labels column', async () => {
    const r = await writeCaseCsv({
      devRoot,
      name: 'Login Flow',
      steps: sampleSteps,
      jiraProjectKey: 'PROJ',
      labels: 'smoke, regression',
    });
    const rows = parseCsv(readFileSync(r.path, 'utf-8'));
    const labels = rows[1][4].split(' ');
    expect(labels).toContain('hover');
    expect(labels).toContain('proj');
    expect(labels).toContain('smoke');
    expect(labels).toContain('regression');
  });

  it('throws CaseCsvExistsError when the file already exists and overwrite is false', async () => {
    await writeCaseCsv({ devRoot, name: 'Login Flow', steps: sampleSteps });
    await expect(
      writeCaseCsv({ devRoot, name: 'Login Flow', steps: sampleSteps }),
    ).rejects.toBeInstanceOf(CaseCsvExistsError);
  });

  it('overwrites silently when overwrite: true', async () => {
    const first = await writeCaseCsv({ devRoot, name: 'Login Flow', steps: sampleSteps });
    const updated = await writeCaseCsv({
      devRoot, name: 'Login Flow', steps: sampleSteps, overwrite: true,
      description: 'Updated summary',
    });
    expect(updated.path).toBe(first.path);
    const rows = parseCsv(readFileSync(updated.path, 'utf-8'));
    expect(rows[1][1]).toBe('Updated summary');
  });

  it('throws when there are no replayable steps to describe', async () => {
    const empty: SkillStep[] = [
      { kind: 'user', text: 'just talk' },
      { kind: 'ai', text: 'no actions' },
    ];
    await expect(
      writeCaseCsv({ devRoot, name: 'empty', steps: empty }),
    ).rejects.toThrow(/at least one tool step/);
  });

  it('RFC 4180-escapes fields with commas, quotes, or newlines', async () => {
    const steps: SkillStep[] = [
      ...sampleSteps.slice(0, 1),
      { kind: 'step', tool: 'browser_type', input: { element: 'address', text: 'a, "b", c' } },
      { kind: 'done', summary: 'Done.' },
    ];
    const r = await writeCaseCsv({ devRoot, name: 'esc', steps });
    const csv = readFileSync(r.path, 'utf-8');
    // Doubled quotes; whole cell wrapped because it contains commas + quotes.
    expect(csv).toContain('"Type ""a, \\""b\\"", c"" into address"');
  });
});
