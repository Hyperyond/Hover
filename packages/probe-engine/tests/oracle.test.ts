import { describe, test, expect } from 'vitest';
import {
  adjudicate,
  bodySimilarity,
  containsBMarker,
  crystallizable,
  tokenize,
  type AdjudicateInput,
} from '../src/oracle.js';

// B's order, distinctively B's. The marker (B's email) appears only here.
const B_BODY = JSON.stringify({ id: 'order-2002', owner: 'userB@test', total: 4200, items: ['gpu', 'psu'] });
// A's own order — same structure, A's values. Shares nothing identifying with B.
const A_BODY = JSON.stringify({ id: 'order-1001', owner: 'userA@test', total: 1300, items: ['ssd'] });
// A public catalogue endpoint returns the same payload to everyone.
const PUBLIC_BODY = JSON.stringify({ id: 'catalogue', items: ['gpu', 'psu', 'ssd'], currency: 'USD' });

const B_MARKERS = ['order-2002', 'userB@test'];

function input(over: Partial<AdjudicateInput> = {}): AdjudicateInput {
  return {
    baseline: { status: 200, bodyText: A_BODY },
    attack: { status: 200, bodyText: B_BODY },
    reference: { status: 200, bodyText: B_BODY },
    bMarkers: B_MARKERS,
    ...over,
  };
}

describe('tokenize', () => {
  test('empty / null body → empty set', () => {
    expect(tokenize(null).size).toBe(0);
    expect(tokenize('').size).toBe(0);
  });
  test('extracts value tokens', () => {
    const t = tokenize('{"owner":"userB@test"}');
    expect(t.has('userb@test')).toBe(true);
  });
});

describe('bodySimilarity', () => {
  test('two empty bodies are identical', () => {
    expect(bodySimilarity(null, '')).toBe(1);
  });
  test('empty vs non-empty is fully dissimilar', () => {
    expect(bodySimilarity(null, A_BODY)).toBe(0);
  });
  test('identical bodies → 1', () => {
    expect(bodySimilarity(B_BODY, B_BODY)).toBe(1);
  });
  test('different users score lower than the same user', () => {
    expect(bodySimilarity(B_BODY, B_BODY)).toBeGreaterThan(bodySimilarity(B_BODY, A_BODY));
  });
});

describe('containsBMarker', () => {
  test('detects B marker', () => {
    expect(containsBMarker(B_BODY, B_MARKERS)).toBe(true);
  });
  test('absent in A body', () => {
    expect(containsBMarker(A_BODY, B_MARKERS)).toBe(false);
  });
  test('ignores empty / whitespace markers', () => {
    expect(containsBMarker(B_BODY, ['', '   '])).toBe(false);
  });
});

describe('adjudicate', () => {
  test('CONFIRMED: A reads B private data, distinct from A, matching B reference', () => {
    const r = adjudicate(input());
    expect(r.verdict).toBe('confirmed');
    expect(r.signals.hasBMarker).toBe(true);
    expect(r.signals.differsFromBaseline).toBe(true);
  });

  test('SECURE: hard denial (403)', () => {
    expect(adjudicate(input({ attack: { status: 403, bodyText: null } })).verdict).toBe('secure');
  });

  test('SECURE: hard denial (404)', () => {
    expect(adjudicate(input({ attack: { status: 404, bodyText: '{"error":"not found"}' } })).verdict).toBe('secure');
  });

  test('SECURE: soft denial — 200 with empty/generic body, no B marker', () => {
    const r = adjudicate(input({ attack: { status: 200, bodyText: '{}' } }));
    expect(r.verdict).toBe('secure');
    expect(r.signals.emptyOrGeneric).toBe(true);
  });

  test('LIKELY: public data — matches reference + marker but also matches A baseline', () => {
    // attack == baseline == reference (a public endpoint), marker present in all.
    const r = adjudicate({
      baseline: { status: 200, bodyText: PUBLIC_BODY },
      attack: { status: 200, bodyText: PUBLIC_BODY },
      reference: { status: 200, bodyText: PUBLIC_BODY },
      bMarkers: ['catalogue'],
    });
    expect(r.verdict).toBe('likely');
    expect(r.signals.differsFromBaseline).toBe(false);
  });

  test('UNCERTAIN: 2xx but no B marker and not generic', () => {
    const unrelated = JSON.stringify({ id: 'order-9999', owner: 'userC@test', total: 77, items: ['hdmi-cable'] });
    const r = adjudicate(input({ attack: { status: 200, bodyText: unrelated } }));
    expect(r.verdict).toBe('uncertain');
  });

  test('UNCERTAIN: attack non-2xx, non-deny (5xx)', () => {
    expect(adjudicate(input({ attack: { status: 500, bodyText: 'boom' } })).verdict).toBe('uncertain');
  });

  test('UNCERTAIN: reference not 2xx — cannot establish B data', () => {
    const r = adjudicate(input({ reference: { status: 500, bodyText: null } }));
    expect(r.verdict).toBe('uncertain');
  });

  test('every result carries explanatory reasons', () => {
    expect(adjudicate(input()).reasons.length).toBeGreaterThan(0);
  });
});

describe('crystallizable', () => {
  test('only confirmed crystallizes', () => {
    expect(crystallizable('confirmed')).toBe(true);
    for (const v of ['likely', 'secure', 'uncertain', 'not-tested'] as const) {
      expect(crystallizable(v)).toBe(false);
    }
  });
});
