import { describe, expect, it, vi } from 'vitest';
import type { WriteSpecResult, SkillStep } from '@hover-dev/core/engine';
import { crystallizeCandidate } from '../src/engine/crystallize.js';

const steps: SkillStep[] = [
  { kind: 'user', text: 'log in' },
  { kind: 'step', tool: 'mcp__hovercontrol__fill_control', input: { name: 'Email' } },
  { kind: 'done', summary: 'ok' },
];

describe('crystallizeCandidate', () => {
  it('maps a candidate → writeSpec options (name/description/steps/startUrl)', async () => {
    const fake = vi.fn(
      async (): Promise<WriteSpecResult> => ({ path: '/p/__vibe_tests__/log-in.spec.ts', slug: 'log-in', files: [] }),
    );
    const res = await crystallizeCandidate(
      { devRoot: '/p', target: 'http://localhost:5173', candidate: { name: 'Log in', description: 'auth', steps } },
      fake,
    );
    expect(res.slug).toBe('log-in');
    expect(fake).toHaveBeenCalledOnce();
    expect(fake.mock.calls[0][0]).toMatchObject({
      devRoot: '/p',
      name: 'Log in',
      description: 'auth',
      startUrl: 'http://localhost:5173',
      overwrite: true,
    });
    expect(fake.mock.calls[0][0].steps).toHaveLength(3);
  });
});
