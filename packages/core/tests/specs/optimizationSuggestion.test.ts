import { describe, test, expect } from 'vitest';
import { optimizationSuggestion } from '../../src/specs/optimizationSuggestion.js';

describe('optimizationSuggestion', () => {
  test('never suggests without a sidecar (nothing to optimize from)', () => {
    const s = optimizationSuggestion({
      hasSidecar: false,
      optimizableCount: 3,
      relevantSeedNames: ['oauth-popup'],
    });
    expect(s.suggested).toBe(false);
    expect(s.reasons).toEqual([]);
  });

  test('suggests on optimizable markers alone, with a reason', () => {
    const s = optimizationSuggestion({
      hasSidecar: true,
      optimizableCount: 2,
      relevantSeedNames: [],
    });
    expect(s.suggested).toBe(true);
    expect(s.reasons).toHaveLength(1);
    expect(s.reasons[0]).toContain('2 interactions');
    expect(s.reasons[0]).toContain('complete them');
  });

  test('uses singular phrasing for a single marker', () => {
    const s = optimizationSuggestion({
      hasSidecar: true,
      optimizableCount: 1,
      relevantSeedNames: [],
    });
    expect(s.reasons[0]).toContain('1 interaction couldn');
    expect(s.reasons[0]).toContain('complete it');
  });

  test('suggests on relevant seeds alone, naming them', () => {
    const s = optimizationSuggestion({
      hasSidecar: true,
      optimizableCount: 0,
      relevantSeedNames: ['download', 'oauth-popup'],
    });
    expect(s.suggested).toBe(true);
    expect(s.reasons).toHaveLength(1);
    expect(s.reasons[0]).toContain('2 seeds may apply: download, oauth-popup');
  });

  test('combines both reasons when both apply', () => {
    const s = optimizationSuggestion({
      hasSidecar: true,
      optimizableCount: 1,
      relevantSeedNames: ['download'],
    });
    expect(s.suggested).toBe(true);
    expect(s.reasons).toHaveLength(2);
  });

  test('does not suggest when a sidecar exists but nothing is improvable', () => {
    const s = optimizationSuggestion({
      hasSidecar: true,
      optimizableCount: 0,
      relevantSeedNames: [],
    });
    expect(s.suggested).toBe(false);
    expect(s.reasons).toEqual([]);
  });
});
