import { describe, test, expect } from 'vitest';
import { matchesFlow, matchSeeds, hasAuth } from '../src/match.js';
import type { ProbeFlow } from '../src/types.js';
import type { SecuritySeed } from '../src/seed.js';

function flow(over: Partial<ProbeFlow['request']> = {}): ProbeFlow {
  return {
    request: {
      method: 'GET', url: 'https://app.test/api/orders?id=42',
      headers: { cookie: 'sid=abc' }, bodyText: null, ...over,
    },
  };
}
const seed = (over: Partial<SecuritySeed> = {}): SecuritySeed =>
  ({ name: 's', class: 'idor', match: {}, probe: { strategy: '', signal: '' }, ...over });

describe('hasAuth', () => {
  test('true when a credential header is present', () => {
    expect(hasAuth(flow())).toBe(true);
    expect(hasAuth(flow({ headers: { authorization: 'Bearer x' } }))).toBe(true);
    expect(hasAuth(flow({ headers: { 'x-api-key': 'abc' } }))).toBe(true);
    expect(hasAuth(flow({ headers: { 'content-type': 'application/json' } }))).toBe(false);
  });
  test('matches a credential header regardless of key casing', () => {
    expect(hasAuth(flow({ headers: { Cookie: 'sid=abc' } }))).toBe(true);
    expect(hasAuth(flow({ headers: { Authorization: 'Bearer x' } }))).toBe(true);
  });
});

describe('matchesFlow', () => {
  test('urlParam regex must match the URL', () => {
    expect(matchesFlow(seed({ match: { urlParam: '[?&]id=\\d+' } }), flow())).toBe(true);
    expect(matchesFlow(seed({ match: { urlParam: '/graphql' } }), flow())).toBe(false);
  });
  test('method filter is case-insensitive', () => {
    expect(matchesFlow(seed({ match: { method: ['get'] } }), flow())).toBe(true);
    expect(matchesFlow(seed({ match: { method: ['POST'] } }), flow())).toBe(false);
  });
  test('needsAuth requires a credential header', () => {
    expect(matchesFlow(seed({ match: { needsAuth: true } }), flow())).toBe(true);
    expect(matchesFlow(seed({ match: { needsAuth: true } }), flow({ headers: {} }))).toBe(false);
  });
  test('bodyField regex tests the body', () => {
    const s = seed({ match: { bodyField: '"role"' } });
    expect(matchesFlow(s, flow({ method: 'PATCH', bodyText: '{"role":"admin"}' }))).toBe(true);
    expect(matchesFlow(s, flow({ method: 'PATCH', bodyText: '{"name":"x"}' }))).toBe(false);
  });
  test('a malformed seed regex does not throw — it just does not match', () => {
    expect(matchesFlow(seed({ match: { urlParam: '(' } }), flow())).toBe(false);
  });
  test('a method given as a bare string does not throw — the filter is skipped', () => {
    const bad = seed({ match: { method: 'GET' as unknown as string[] } });
    expect(() => matchesFlow(bad, flow())).not.toThrow();
    expect(matchesFlow(bad, flow())).toBe(true);
  });
});

describe('matchSeeds', () => {
  test('returns every relevant seed', () => {
    const seeds = [
      seed({ name: 'a', match: { urlParam: 'id=' } }),
      seed({ name: 'b', match: { urlParam: '/graphql' } }),
    ];
    expect(matchSeeds(flow(), seeds).map(s => s.name)).toEqual(['a']);
  });
});
