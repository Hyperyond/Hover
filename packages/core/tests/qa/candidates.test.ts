import { describe, it, expect } from 'vitest';
import { resolveCandidates } from '../../src/qa/candidates.js';
import type { SkillStep } from '../../src/specs/specStep.js';

/** A run of mixed steps: actuations (counted) interleaved with non-actuation
 *  noise (snapshots, source reads, ask_user) that must NOT consume a number. */
const run: SkillStep[] = [
  { kind: 'user', text: 'test the app' },
  { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Login' } }, // step 1
  { kind: 'step', tool: 'browser_snapshot' }, // noise — not counted
  { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'email', value: 'a@b.com' } }, // step 2
  { kind: 'step', tool: 'mcp__hover-source__read_source', input: {} }, // noise
  { kind: 'step', tool: 'mcp__hover-control__fill_control', input: { role: 'textbox', name: 'password', value: 'pw' } }, // step 3
  { kind: 'step', tool: 'mcp__hover-control__click_control', input: { role: 'button', name: 'Submit' } }, // step 4
  { kind: 'step', tool: 'mcp__hover-control__check_control', input: { role: 'checkbox', name: 'Remember me' } }, // step 5
  { kind: 'done', summary: 'done' },
];

describe('resolveCandidates', () => {
  it('maps step numbers to the actual recorded actuation steps, skipping noise', () => {
    const out = resolveCandidates(run, [{ name: 'Log in', steps: [1, 2, 3, 4] }]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Log in');
    expect(out[0].stepCount).toBe(4);
    // step 2 is the email fill (the browser_snapshot between did NOT consume a number)
    expect((out[0].steps[1].input as Record<string, unknown>).name).toBe('email');
    expect((out[0].steps[3].input as Record<string, unknown>).name).toBe('Submit');
    // every resolved step is a real recorded actuation, never re-described
    expect(out[0].steps.every((s) => s.kind === 'step' && s.tool?.includes('_control'))).toBe(true);
  });

  it('drops out-of-range numbers but keeps the valid ones', () => {
    const out = resolveCandidates(run, [{ name: 'Partial', steps: [4, 99, 5] }]);
    expect(out).toHaveLength(1);
    expect(out[0].stepCount).toBe(2);
    expect((out[0].steps[0].input as Record<string, unknown>).name).toBe('Submit');
    expect((out[0].steps[1].input as Record<string, unknown>).name).toBe('Remember me');
  });

  it('drops a candidate that resolves to no steps, or has no name', () => {
    expect(resolveCandidates(run, [{ name: 'Ghost', steps: [42] }])).toHaveLength(0);
    expect(resolveCandidates(run, [{ name: '  ', steps: [1] }])).toHaveLength(0);
  });

  it('de-dupes identical candidates (same name + step set)', () => {
    const out = resolveCandidates(run, [
      { name: 'Log in', steps: [1, 2, 3, 4] },
      { name: 'Log in', steps: [1, 2, 3, 4] },
    ]);
    expect(out).toHaveLength(1);
  });

  it('preserves the agent-given flow order', () => {
    const out = resolveCandidates(run, [{ name: 'Reordered', steps: [4, 1] }]);
    expect((out[0].steps[0].input as Record<string, unknown>).name).toBe('Submit');
    expect((out[0].steps[1].input as Record<string, unknown>).name).toBe('Login');
  });
});
