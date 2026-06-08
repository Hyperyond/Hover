import { describe, test, expect } from 'vitest';
import { planSweep } from '../src/sweep.js';
import type { IdentifiedFlow } from '../src/suggest.js';

function flow(id: string, over: Partial<IdentifiedFlow['request']> = {}): IdentifiedFlow {
  return {
    id,
    request: { method: 'GET', url: 'https://app.test/', headers: { cookie: 'sid=x' }, bodyText: null, ...over },
  };
}

describe('planSweep', () => {
  test('plans a probe per matching (flow, seed) with risk flags', () => {
    const { probes } = planSweep([flow('f1', { url: 'https://app.test/api/orders?id=7' })]);
    const idor = probes.find(p => p.class === 'idor');
    expect(idor).toBeDefined();
    expect(idor!.flowId).toBe('f1');
    expect(idor!.secondIdentity).toBe(true); // idor-numeric-id needs identity B
    expect(idor!.destructive).toBe(false);
  });

  test('holds destructive probes back by default (engine-enforced gate)', () => {
    // a POST flow matches mass-assignment, which is destructive
    const plan = planSweep([flow('f2', { method: 'POST', url: 'https://app.test/api/me', bodyText: '{}' })]);
    expect(plan.probes.some(p => p.class === 'mass-assignment')).toBe(false);
    expect(plan.skipped.some(p => p.class === 'mass-assignment' && p.destructive)).toBe(true);
  });

  test('includes destructive probes when explicitly allowed', () => {
    const plan = planSweep(
      [flow('f2', { method: 'POST', url: 'https://app.test/api/me', bodyText: '{}' })],
      { allowDestructive: true },
    );
    expect(plan.probes.some(p => p.class === 'mass-assignment')).toBe(true);
    expect(plan.skipped).toEqual([]);
  });

  test('unauthenticated flows yield nothing (built-ins need auth)', () => {
    const plan = planSweep([flow('f3', { url: 'https://app.test/api/orders?id=7', headers: {} })]);
    expect(plan.probes).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
