import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecuritySeeds, isSecuritySeed } from '../../src/probes/seed.js';

let devRoot: string;
beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-sec-seed-')); });
afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

const idor = {
  name: 'idor-numeric-id', class: 'idor',
  match: { urlParam: '[?&]id=\\d+', needsAuth: true },
  probe: { strategy: 'replay as B', signal: 'B gets A data' },
};
const optimizationSeed = { name: 'download', signature: ['browser_click'], example: { steps: [], code: 'x' } };

function writeRule(rel: string, obj: unknown): void {
  const p = join(devRoot, '.hover', 'rules', rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(obj), 'utf-8');
}

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

describe('loadSecuritySeeds', () => {
  test('loads from rules/ and rules/security/, ignores optimization seeds', async () => {
    writeRule('security/idor.json', idor);
    writeRule('download.json', optimizationSeed);
    const seeds = await loadSecuritySeeds(devRoot);
    expect(seeds.map(s => s.name)).toEqual(['idor-numeric-id']);
  });
  test('returns [] when no rules dir exists', async () => {
    expect(await loadSecuritySeeds(devRoot)).toEqual([]);
  });
  test('dedupes by name when a seed is in both rules/ and rules/security/', async () => {
    writeRule('idor.json', idor);
    writeRule('security/idor.json', idor);
    const seeds = await loadSecuritySeeds(devRoot);
    expect(seeds.map(s => s.name)).toEqual(['idor-numeric-id']);
  });
});
