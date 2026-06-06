import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_SEEDS, readSeeds, relevantSeeds } from '../../src/specs/seeds.js';
import { buildOptimizePrompt } from '../../src/specs/optimizeSpec.js';

describe('readSeeds', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'hover-seeds-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('returns built-in seeds when no .hover/rules/ exists', async () => {
    const seeds = await readSeeds(tmp);
    expect(seeds).toEqual(BUILTIN_SEEDS);
  });

  test('appends valid project seeds from .hover/rules/*.json', async () => {
    mkdirSync(join(tmp, '.hover', 'rules'), { recursive: true });
    writeFileSync(
      join(tmp, '.hover', 'rules', 'oauth.json'),
      JSON.stringify({
        name: 'oauth-popup',
        signature: ['browser_click', 'browser_tabs:select'],
        note: 'sign in via a provider popup',
        example: { steps: [{ tool: 'browser_click', element: 'Sign in with Google' }], code: '// ...' },
      }),
    );

    const seeds = await readSeeds(tmp);
    expect(seeds.length).toBe(BUILTIN_SEEDS.length + 1);
    expect(seeds.some(s => s.name === 'oauth-popup')).toBe(true);
  });

  test('skips malformed / incomplete seed files without throwing', async () => {
    mkdirSync(join(tmp, '.hover', 'rules'), { recursive: true });
    writeFileSync(join(tmp, '.hover', 'rules', 'broken.json'), '{ not json');
    writeFileSync(
      join(tmp, '.hover', 'rules', 'incomplete.json'),
      JSON.stringify({ name: 'no-example', signature: ['x'] }), // missing example.code
    );
    writeFileSync(join(tmp, '.hover', 'rules', 'notes.txt'), 'ignored — not .json');

    const seeds = await readSeeds(tmp);
    expect(seeds).toEqual(BUILTIN_SEEDS);
  });
});

describe('relevantSeeds', () => {
  test('keeps only seeds whose signature base-tool appears in the spec', () => {
    const seeds = [
      { name: 'a', signature: ['browser_click'], example: { steps: [], code: '' } },
      { name: 'b', signature: ['browser_file_upload'], example: { steps: [], code: '' } },
    ];
    expect(relevantSeeds(seeds, new Set(['browser_click'])).map(s => s.name)).toEqual(['a']);
    expect(relevantSeeds(seeds, new Set(['browser_navigate']))).toEqual([]);
  });

  test('matches on the base tool, ignoring the :detail suffix', () => {
    const seed = {
      name: 'tabs',
      signature: ['browser_tabs:select'],
      example: { steps: [], code: '' },
    };
    expect(relevantSeeds([seed], new Set(['browser_tabs'])).length).toBe(1);
  });

  test('caps the number of returned seeds', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      name: `s${i}`,
      signature: ['browser_click'],
      example: { steps: [], code: '' },
    }));
    expect(relevantSeeds(many, new Set(['browser_click']), 3).length).toBe(3);
  });
});

describe('buildOptimizePrompt with seeds', () => {
  test('includes a WORKED EXAMPLES section listing the seeds', () => {
    const prompt = buildOptimizePrompt('// draft', null, BUILTIN_SEEDS);
    expect(prompt).toContain('WORKED EXAMPLES');
    expect(prompt).toContain('# download');
    expect(prompt).toContain("waitForEvent('download')");
  });

  test('omits the WORKED EXAMPLES section when there are no seeds', () => {
    const prompt = buildOptimizePrompt('// draft', null, []);
    expect(prompt).not.toContain('WORKED EXAMPLES');
  });
});
