import { describe, test, expect } from 'vitest';
import { gateFinding } from '../../src/probes/gate.js';

const base = { title: 'IDOR on /api/orders', exploitableNow: true, impactProven: true, alreadyKnown: false };

describe('gateFinding', () => {
  test('PASS when exploitable now, impact proven, not already-known', () => {
    expect(gateFinding(base).verdict).toBe('pass');
  });
  test('KILL on the never-submit list', () => {
    expect(gateFinding({ ...base, title: 'Self-XSS in profile' }).verdict).toBe('kill');
    expect(gateFinding({ ...base, title: 'Missing security header' }).verdict).toBe('kill');
  });
  test('KILL when not exploitable now', () => {
    expect(gateFinding({ ...base, exploitableNow: false }).verdict).toBe('kill');
  });
  test('DOWNGRADE when impact unproven or already-known', () => {
    expect(gateFinding({ ...base, impactProven: false }).verdict).toBe('downgrade');
    expect(gateFinding({ ...base, alreadyKnown: true }).verdict).toBe('downgrade');
  });
  test('CHAIN when only exploitable in combination', () => {
    expect(gateFinding({ ...base, needsChain: true }).verdict).toBe('chain');
  });
  test('does not KILL a real finding that merely mentions a missing header', () => {
    // "missing security header" is suppressed; a bare "missing header" mention
    // inside a legit IDOR title must NOT be killed.
    const r = gateFinding({ ...base, title: 'IDOR on /api/orders (missing header X-Tenant)' });
    expect(r.verdict).toBe('pass');
  });
});
