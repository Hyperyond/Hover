import { describe, test, expect } from 'vitest';
import { suggestProbes, type IdentifiedFlow } from '../src/suggest.js';
import { builtinSecuritySeeds } from '../src/builtins.js';
import { isSecuritySeed } from '../src/seed.js';

function flow(id: string, over: Partial<IdentifiedFlow['request']> = {}): IdentifiedFlow {
  return {
    id,
    request: {
      method: 'GET', url: 'https://app.test/', headers: { cookie: 'sid=abc' }, bodyText: null, ...over,
    },
  };
}

describe('builtinSecuritySeeds', () => {
  test('every built-in is a valid security seed', () => {
    expect(builtinSecuritySeeds.length).toBeGreaterThan(0);
    for (const s of builtinSecuritySeeds) expect(isSecuritySeed(s)).toBe(true);
  });
  test('seed names are unique', () => {
    const names = builtinSecuritySeeds.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('suggestProbes', () => {
  test('flags a numeric-id authed GET as an IDOR candidate', () => {
    const out = suggestProbes([flow('f1', { url: 'https://app.test/api/orders?id=42' })]);
    const idor = out.find(s => s.class === 'idor');
    expect(idor).toBeDefined();
    expect(idor!.flowId).toBe('f1');
    expect(idor!.strategy).toMatch(/replay/i);
  });
  test('flags a url= param as an SSRF candidate', () => {
    const out = suggestProbes([flow('f2', { url: 'https://app.test/fetch?url=x' })]);
    expect(out.some(s => s.class === 'ssrf' && s.flowId === 'f2')).toBe(true);
  });
  test('a plain authed GET with no interesting shape yields a bfla/auth hint at most, not IDOR/SSRF', () => {
    const out = suggestProbes([flow('f3', { url: 'https://app.test/api/profile' })]);
    expect(out.some(s => s.class === 'idor')).toBe(false);
    expect(out.some(s => s.class === 'ssrf')).toBe(false);
  });
  test('an unauthenticated request surfaces vuln candidates (injection needs no auth) but no authz', () => {
    const out = suggestProbes([flow('f4', { url: 'https://app.test/api/orders?id=42', headers: {} })]);
    expect(out.some(s => s.class === 'idor')).toBe(false); // authz seeds need auth
    expect(out.some(s => s.class === 'sqli')).toBe(true);  // injection doesn't
  });
  test('returns flat suggestions across multiple flows', () => {
    const out = suggestProbes([
      flow('f1', { url: 'https://app.test/api/orders?id=42' }),
      flow('f2', { url: 'https://app.test/fetch?url=x' }),
    ]);
    expect(new Set(out.map(s => s.flowId))).toEqual(new Set(['f1', 'f2']));
  });
});
