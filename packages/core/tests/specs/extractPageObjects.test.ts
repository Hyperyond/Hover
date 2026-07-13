import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSpec } from '../../src/specs/writeSpec.js';
import { extractPageObjects, detectExtractableFlows } from '../../src/specs/extractPageObjects.js';
import type { SkillStep } from '../../src/specs/specStep.js';

const nav = (url: string): SkillStep => ({ kind: 'step', tool: 'browser_navigate', input: { url } });
const click = (name: string): SkillStep => ({ kind: 'step', tool: 'click_control', input: { role: 'button', name } });
const fill = (name: string, value: string): SkillStep => ({ kind: 'step', tool: 'fill_control', input: { role: 'textbox', name, value } });

describe('extractPageObjects', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pom-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = (name: string, steps: SkillStep[]) =>
    writeSpec({ devRoot: dir, name, steps, startUrl: 'http://localhost:5173', overwrite: true });

  it('extracts a shared NON-login prefix into a Page Object + fixtures and folds the specs', async () => {
    // Two specs share [go /dashboard → click Overview], then diverge.
    await write('open reports', [nav('http://localhost:5173/dashboard'), click('Overview'), click('Reports')]);
    await write('open members', [nav('http://localhost:5173/dashboard'), click('Overview'), click('Members')]);

    const res = await extractPageObjects(dir, { minSpecs: 2 });
    expect(res.pages.length).toBeGreaterThan(0);
    expect(res.fixturesPath).toBeTruthy();
    expect(res.folded.sort()).toEqual(['open-members', 'open-reports']);

    // A page object + fixtures were written.
    expect(existsSync(join(dir, '__vibe_tests__', 'fixtures.ts'))).toBe(true);
    const pageFiles = await readdir(join(dir, '__vibe_tests__', 'pages'));
    expect(pageFiles.length).toBeGreaterThan(0);
    // The Page Object METHOD BODY must replay the shared grounded steps — not
    // just the navigation (guards the grounded-tool gap in generatePageObject).
    const po = await readFile(join(dir, '__vibe_tests__', 'pages', pageFiles[0]), 'utf-8');
    expect(po).toContain('getByRole("button", { name: "Overview"');
    expect(po).toContain('.click()');

    // The folded specs now import from ../fixtures (they live in e2e/) and call
    // the page method.
    const reports = await readFile(join(dir, '__vibe_tests__', 'e2e', 'open-reports.spec.ts'), 'utf-8');
    expect(reports).toContain("from '../fixtures'");
    expect(reports).toMatch(/await \w+Page\.\w+\(/);
  });

  it('EXCLUDES a login prefix (auth-fixture owns it) from extraction', async () => {
    // Two specs share a login prefix (a redacted credential fill).
    const loginPrefix = [nav('http://localhost:5173/login'), fill('Password', '123456789'), click('Log in')];
    await writeSpec({ devRoot: dir, name: 'a', overwrite: true, startUrl: 'http://localhost:5173',
      redactions: [{ value: '123456789', envVar: 'HOVER_PASSWORD' }], steps: [...loginPrefix, click('Alpha')] });
    await writeSpec({ devRoot: dir, name: 'b', overwrite: true, startUrl: 'http://localhost:5173',
      redactions: [{ value: '123456789', envVar: 'HOVER_PASSWORD' }], steps: [...loginPrefix, click('Beta')] });

    const flows = await detectExtractableFlows(dir, 2);
    expect(flows).toHaveLength(0); // the only shared prefix is the login → excluded
    const res = await extractPageObjects(dir, { minSpecs: 2 });
    expect(res.pages).toHaveLength(0);
  });

  it('no-ops when nothing is shared', async () => {
    await write('solo one', [nav('http://localhost:5173/x'), click('One')]);
    await write('solo two', [nav('http://localhost:5173/y'), click('Two')]);
    const res = await extractPageObjects(dir, { minSpecs: 2 });
    expect(res.pages).toHaveLength(0);
    expect(res.folded).toHaveLength(0);
  });
});
