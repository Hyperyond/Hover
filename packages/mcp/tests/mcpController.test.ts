import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { HoverMcpController } from '../src/mcp/controller.js';
import type { SkillStep } from '@hover-dev/core/engine';

function mockPage(opts: { visible?: boolean } = {}) {
  const actions: string[] = [];
  const mkLoc = (label: string): Record<string, unknown> => ({
    first: () => mkLoc(label),
    click: async () => void actions.push(`click ${label}`),
    fill: async (v: string) => void actions.push(`fill ${label}=${v}`),
    selectOption: async (v: string) => void actions.push(`select ${label}=${v}`),
    check: async () => void actions.push(`check ${label}`),
    uncheck: async () => void actions.push(`uncheck ${label}`),
    isVisible: async () => opts.visible ?? true,
    ariaSnapshot: async () => '- button "Sign in"',
    getByRole: (r: string, o?: { name?: string }) => mkLoc(`${r}:${o?.name}`),
    getByTestId: (t: string) => mkLoc(`testId:${t}`),
    getByText: (t: string) => mkLoc(`text:${t}`),
  });
  const page = {
    goto: async () => void actions.push('goto'),
    locator: () => mkLoc('body'),
    getByRole: (r: string, o?: { name?: string }) => mkLoc(`${r}:${o?.name}`),
    getByTestId: (t: string) => mkLoc(`testId:${t}`),
    getByText: (t: string) => mkLoc(`text:${t}`),
    // livePage() attaches a passive 'response' listener for API capture.
    on: () => {},
    actions,
  };
  return page as unknown as Page & { actions: string[] };
}

describe('HoverMcpController', () => {
  it('actuates the page and buffers each action as a grounded step', async () => {
    const page = mockPage();
    const crystallize = vi.fn(async () => ({ path: '/p/__vibe_tests__/log-in.spec.ts' }));
    const c = new HoverMcpController({ getPage: async () => page, crystallize });

    await c.click({ role: 'button', name: 'Sign in' });
    await c.fill({ role: 'textbox', name: 'Email' }, 'a@b.com');
    await c.check({ role: 'checkbox', name: 'Remember' }, false);

    expect(page.actions).toEqual(['click button:Sign in', 'fill textbox:Email=a@b.com', 'uncheck checkbox:Remember']);
    expect(c.steps.map((s: SkillStep) => s.tool)).toEqual(['click_control', 'fill_control', 'check_control']);
    // fill buffers the value; check buffers the checked flag.
    expect((c.steps[1].input as { value: string }).value).toBe('a@b.com');
    expect((c.steps[2].input as { checked: boolean }).checked).toBe(false);
  });

  it('crystallize writes the buffered steps then clears the buffer', async () => {
    const page = mockPage();
    const crystallize = vi.fn(async () => ({ path: '/p/__vibe_tests__/log-in.spec.ts' }));
    const c = new HoverMcpController({ getPage: async () => page, crystallize });

    await c.click({ role: 'button', name: 'Sign in' });
    const out = await c.crystallize('Log in', 'auth flow');

    expect(out).toContain('log-in.spec.ts');
    expect(crystallize).toHaveBeenCalledOnce();
    expect(crystallize.mock.calls[0]).toEqual(['Log in', 'auth flow', expect.any(Array)]);
    expect((crystallize.mock.calls[0][2] as SkillStep[])).toHaveLength(1);
    expect(c.steps).toHaveLength(0); // buffer cleared for the next flow
  });

  it('crystallize with an empty buffer writes nothing', async () => {
    const crystallize = vi.fn();
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize });
    const out = await c.crystallize('X');
    expect(out).toContain('Nothing to crystallize');
    expect(crystallize).not.toHaveBeenCalled();
  });

  it('record_fact persists a rule and recall returns known knowledge', async () => {
    const recordFact = vi.fn(async () => ({ path: '/p/.hover/memory/guests-cannot-checkout.md' }));
    const recall = vi.fn(async () => 'KNOWN BUSINESS KNOWLEDGE...\n- guests cannot checkout');
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }), recordFact, recall });

    expect(await c.recordFact('guests cannot checkout', 'must log in before checkout')).toContain('✓ remembered');
    expect(recordFact).toHaveBeenCalledWith('guests cannot checkout', 'must log in before checkout', 'business-rule');
    expect(await c.recall()).toContain('guests cannot checkout');
  });

  it('record_fact / recall degrade gracefully when the deps are absent', async () => {
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }) });
    expect(await c.recordFact('t', 'r')).toContain('unavailable');
    expect(await c.recall()).toContain('No business memory');
  });

  it('assert_visible throws (→ ✗ to the agent) when the target is not visible', async () => {
    const c = new HoverMcpController({ getPage: async () => mockPage({ visible: false }), crystallize: async () => ({ path: 'x' }) });
    await expect(c.assertVisible({ text: 'Welcome' })).rejects.toThrow('not visible');
    expect(c.steps).toHaveLength(0); // a failed assert is not buffered
  });
});
