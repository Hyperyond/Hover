import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSidecar } from '../../src/specs/sidecar.js';
import { detectSharedFlows, stepSignature } from '../../src/specs/detectSharedFlows.js';
import type { SkillStep } from '../../src/specs/specStep.js';

let devRoot: string;
beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-detect-')); });
afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

const loginPrefix: SkillStep[] = [
  { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
  { kind: 'step', tool: 'browser_type', input: { element: 'Email textbox', text: 'a@b.co' } },
  { kind: 'step', tool: 'browser_click', input: { element: 'Sign in button' } },
];

async function sidecar(slug: string, steps: SkillStep[]): Promise<void> {
  await writeSidecar(devRoot, { slug, name: slug, steps, assertions: [] });
}

describe('stepSignature', () => {
  it('keeps the target and drops data values (type text, fill values)', () => {
    expect(stepSignature('browser_type', { element: 'Email textbox', text: 'a@b.co' }))
      .toBe(stepSignature('browser_type', { element: 'Email textbox', text: 'z@z.co' }));
    expect(stepSignature('browser_fill_form', { fields: [{ name: 'Email', value: 'a' }] }))
      .toBe('fill:Email');
  });

  it('sorts fill-form field names so field order does not matter', () => {
    const a = stepSignature('browser_fill_form', { fields: [{ name: 'Email' }, { name: 'Pass' }] });
    const b = stepSignature('browser_fill_form', { fields: [{ name: 'Pass' }, { name: 'Email' }] });
    expect(a).toBe(b);
  });

  it('returns null for non-flow steps (diagnostics, tabs)', () => {
    expect(stepSignature('browser_snapshot', {})).toBeNull();
    expect(stepSignature('browser_tabs', { action: 'select' })).toBeNull();
  });

  it('normalizes navigation to the path only', () => {
    expect(stepSignature('browser_navigate', { url: 'http://localhost:5173/login?x=1' }))
      .toBe('navigate:/login');
  });
});

describe('detectSharedFlows', () => {
  it('reports a shared login prefix across specs, ignoring data values', async () => {
    await sidecar('add-todo', [
      ...loginPrefix,
      { kind: 'step', tool: 'browser_click', input: { element: 'Add todo button' } },
    ]);
    await sidecar('edit-profile', [
      ...loginPrefix,
      { kind: 'step', tool: 'browser_click', input: { element: 'Profile link' } },
    ]);
    // Same flow shape, different typed email — must not break the signature.
    await sidecar('delete-acct', [
      { kind: 'step', tool: 'browser_navigate', input: { url: 'http://localhost:5173/login' } },
      { kind: 'step', tool: 'browser_type', input: { element: 'Email textbox', text: 'z@z.co' } },
      { kind: 'step', tool: 'browser_click', input: { element: 'Sign in button' } },
      { kind: 'step', tool: 'browser_click', input: { element: 'Delete account button' } },
    ]);

    const flows = await detectSharedFlows(devRoot);
    expect(flows).toHaveLength(1);
    expect(flows[0].specs).toEqual(['add-todo', 'delete-acct', 'edit-profile']);
    expect(flows[0].signatures).toHaveLength(3); // navigate + type + click(sign in)
    expect(flows[0].prose[0]).toContain('Open http://localhost:5173/login');
    expect(flows[0].prose[2]).toContain('Sign in button');
  });

  it('reports nothing when fewer than minSpecs share the prefix', async () => {
    await sidecar('only-one', loginPrefix);
    expect(await detectSharedFlows(devRoot)).toHaveLength(0);
  });

  it('reports nothing when the shared prefix is shorter than minLen', async () => {
    // Both start at /x then diverge immediately — shared prefix is length 1.
    await sidecar('a', [
      { kind: 'step', tool: 'browser_navigate', input: { url: '/x' } },
      { kind: 'step', tool: 'browser_click', input: { element: 'A button' } },
    ]);
    await sidecar('b', [
      { kind: 'step', tool: 'browser_navigate', input: { url: '/x' } },
      { kind: 'step', tool: 'browser_click', input: { element: 'B button' } },
    ]);
    expect(await detectSharedFlows(devRoot)).toHaveLength(0);
  });

  it('honors a custom minSpecs threshold (e.g. Stage 3 uses 3)', async () => {
    await sidecar('one', loginPrefix);
    await sidecar('two', loginPrefix);
    expect(await detectSharedFlows(devRoot, { minSpecs: 3 })).toHaveLength(0);
    expect(await detectSharedFlows(devRoot, { minSpecs: 2 })).toHaveLength(1);
  });

  it('returns an empty list when there are no sidecars', async () => {
    expect(await detectSharedFlows(devRoot)).toEqual([]);
  });
});
