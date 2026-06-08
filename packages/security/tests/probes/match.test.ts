import { describe, test, expect } from 'vitest';
import { matchesFlow, matchSeeds, hasAuth } from '../../src/probes/match.js';
import type { Flow } from '../../src/mitm/flows.js';
import type { SecuritySeed } from '../../src/probes/seed.js';

function flow(over: Partial<Flow['request']> = {}): Flow {
  return {
    id: 'f1', mutated: false,
    request: {
      method: 'GET', url: 'https://app.test/api/orders?id=42', httpVersion: '1.1',
      headers: { cookie: 'sid=abc' }, bodyText: null, bodyLen: 0, startedAt: 0, ...over,
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
    // a malformed seed should never crash matching (the loader guard also
    // rejects these, but matchesFlow is defensive too)
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
