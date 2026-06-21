import { describe, it, expect } from 'vitest';
import { finalizeCandidates } from '../../src/qa/candidates.js';
import type { SkillStep } from '../../src/specs/specStep.js';

const click = (name: string): SkillStep => ({ kind: 'step', tool: 'click_control', input: { role: 'button', name } });

describe('finalizeCandidates', () => {
  it('keeps candidates that have a name + steps, stamping stepCount', () => {
    const out = finalizeCandidates([
      { name: 'Log in', description: 'sign in', steps: [click('email'), click('Submit')] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Log in', description: 'sign in', stepCount: 2 });
    expect(out[0].steps).toHaveLength(2);
  });

  it('drops candidates with no name or no steps', () => {
    expect(finalizeCandidates([{ name: '  ', steps: [click('x')] }])).toHaveLength(0);
    expect(finalizeCandidates([{ name: 'Empty', steps: [] }])).toHaveLength(0);
  });

  it('ignores non-step entries when counting', () => {
    const out = finalizeCandidates([
      { name: 'Mixed', steps: [click('a'), { kind: 'user', text: 'noise' } as SkillStep, click('b')] },
    ]);
    expect(out[0].stepCount).toBe(2);
  });

  it('de-dupes identical candidates (same name + step count)', () => {
    const out = finalizeCandidates([
      { name: 'Log in', steps: [click('a'), click('b')] },
      { name: 'Log in', steps: [click('a'), click('b')] },
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps distinct flows', () => {
    const out = finalizeCandidates([
      { name: 'Log in', steps: [click('a')] },
      { name: 'Add to cart', steps: [click('b'), click('c')] },
    ]);
    expect(out.map((c) => c.name)).toEqual(['Log in', 'Add to cart']);
  });
});
