import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { replayOnPage, type ReplayStep } from '../../src/specs/replayGrounded.js';

/* Drive replayOnPage with a mock Page — no real browser. The mock records the
 * actions it's asked to perform and can simulate a not-visible element. */
function mockPage(opts: { visible?: (label: string) => boolean; clickThrows?: boolean } = {}) {
  const actions: string[] = [];
  const mkLoc = (label: string): Record<string, unknown> => ({
    first: () => mkLoc(label),
    click: async () => {
      actions.push(`click ${label}`);
      if (opts.clickThrows) throw new Error('element is not clickable');
    },
    fill: async (v: string) => void actions.push(`fill ${label}=${v}`),
    selectOption: async (v: string) => void actions.push(`select ${label}=${v}`),
    check: async () => void actions.push(`check ${label}`),
    uncheck: async () => void actions.push(`uncheck ${label}`),
    isVisible: async () => (opts.visible ? opts.visible(label) : true),
    getByRole: (r: string, o?: { name?: string }) => mkLoc(`${r}:${o?.name}`),
    getByTestId: (t: string) => mkLoc(`testId:${t}`),
    getByText: (t: string) => mkLoc(`text:${t}`),
  });
  const page = {
    goto: async () => void actions.push('goto'),
    getByRole: (r: string, o?: { name?: string }) => mkLoc(`${r}:${o?.name}`),
    getByTestId: (t: string) => mkLoc(`testId:${t}`),
    getByText: (t: string) => mkLoc(`text:${t}`),
    actions,
  };
  return page as unknown as Page & { actions: string[] };
}

const steps: ReplayStep[] = [
  { kind: 'user', text: 'log in' }, // skipped, not counted
  { kind: 'step', tool: 'click_control', input: { role: 'button', name: 'Sign in' } },
  { kind: 'step', tool: 'fill_control', input: { role: 'textbox', name: 'Email', value: 'a@b.com' } },
  { kind: 'step', tool: 'check_control', input: { role: 'checkbox', name: 'Remember', checked: false } },
  { kind: 'step', tool: 'assert_visible', input: { text: 'Welcome' } },
  { kind: 'done', summary: 'ok' }, // skipped
];

describe('replayOnPage', () => {
  it('runs every grounded step and reports ok when they all pass', async () => {
    const page = mockPage();
    const res = await replayOnPage(page, 'http://localhost:5173', steps);
    expect(res.ok).toBe(true);
    expect(res.total).toBe(4); // 4 actuations; user/done skipped
    expect(res.ran).toBe(4);
    expect(page.actions).toEqual([
      'goto',
      'click button:Sign in',
      'fill textbox:Email=a@b.com',
      'uncheck checkbox:Remember',
    ]);
  });

  it('fails (and stops) when an assert_visible target is not visible', async () => {
    const page = mockPage({ visible: (l) => l !== 'text:Welcome' });
    const res = await replayOnPage(page, 'http://x', steps);
    expect(res.ok).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toMatchObject({ tool: 'assert_visible' });
    expect(res.failures[0].error).toContain('not visible');
  });

  it('fails when an action throws, recording the offending step', async () => {
    const page = mockPage({ clickThrows: true });
    const res = await replayOnPage(page, 'http://x', steps);
    expect(res.ok).toBe(false);
    expect(res.failures[0]).toMatchObject({ tool: 'click_control', target: 'button "Sign in"' });
    expect(res.ran).toBe(0); // failed on the first action
  });

  it('reports a locate failure when no target fields are supplied', async () => {
    const page = mockPage();
    const res = await replayOnPage(page, 'http://x', [{ kind: 'step', tool: 'click_control', input: {} }]);
    expect(res.ok).toBe(false);
    expect(res.failures[0].error).toContain('could not locate');
  });
});
