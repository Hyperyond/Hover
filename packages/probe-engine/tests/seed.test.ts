import { describe, test, expect } from 'vitest';
import { isSecuritySeed } from '../src/seed.js';
import { builtinSecuritySeeds } from '../src/builtins.js';

const idor = {
  name: 'idor-numeric-id', class: 'idor',
  match: { urlParam: '[?&]id=\\d+', needsAuth: true },
  probe: { strategy: 'replay as B', signal: 'B gets A data' },
};
const optimizationSeed = { name: 'download', signature: ['browser_click'], example: { steps: [], code: 'x' } };

describe('isSecuritySeed', () => {
  test('accepts a probe seed, rejects an optimization seed', () => {
    expect(isSecuritySeed(idor)).toBe(true);
    expect(isSecuritySeed(optimizationSeed)).toBe(false);
    expect(isSecuritySeed(null)).toBe(false);
  });
  test('rejects a seed whose probe is missing signal', () => {
    expect(isSecuritySeed({ ...idor, probe: { strategy: 'x' } })).toBe(false);
  });
  test('rejects a seed whose match.method is not an array', () => {
    // would otherwise crash matchesFlow with a TypeError on .map()
    expect(isSecuritySeed({ ...idor, match: { method: 'GET' } })).toBe(false);
  });
});

describe('builtinSecuritySeeds (inlined catalogue)', () => {
  test('ships a non-empty catalogue of well-formed seeds with unique names', () => {
    expect(builtinSecuritySeeds.length).toBeGreaterThan(0);
    expect(builtinSecuritySeeds.every(isSecuritySeed)).toBe(true);
    const names = builtinSecuritySeeds.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
  test('covers both authz (security) and vuln (pentest) categories', () => {
    const cats = new Set(builtinSecuritySeeds.map(s => s.category));
    expect(cats.has('authz')).toBe(true);
    expect(cats.has('vuln')).toBe(true);
  });
});
