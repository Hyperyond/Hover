import { describe, test, expect } from 'vitest';
import { BUILTIN_SEEDS, relevantSeeds } from '../../src/specs/seeds.js';
import { buildOptimizePrompt } from '../../src/specs/optimizeSpec.js';

describe('BUILTIN_SEEDS (inlined catalogue)', () => {
  test('ships a non-empty catalogue of well-formed seeds with unique names', () => {
    expect(BUILTIN_SEEDS.length).toBeGreaterThan(0);
    expect(BUILTIN_SEEDS.every(s => s.name && Array.isArray(s.signature) && !!s.example?.code)).toBe(true);
    const names = BUILTIN_SEEDS.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
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
