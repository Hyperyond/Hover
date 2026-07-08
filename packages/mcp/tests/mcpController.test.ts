import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { HoverMcpController } from '../src/mcp/controller.js';
import type { SkillStep } from '@hover-dev/core/engine';

function mockPage(opts: { visible?: boolean; fieldType?: string } = {}) {
  const actions: string[] = [];
  const mkLoc = (label: string): Record<string, unknown> => ({
    first: () => mkLoc(label),
    click: async () => void actions.push(`click ${label}`),
    fill: async (v: string) => void actions.push(`fill ${label}=${v}`),
    selectOption: async (v: string) => void actions.push(`select ${label}=${v}`),
    check: async () => void actions.push(`check ${label}`),
    uncheck: async () => void actions.push(`uncheck ${label}`),
    isVisible: async () => opts.visible ?? true,
    getAttribute: async (n: string) => (n === 'type' ? (opts.fieldType ?? null) : null),
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
    expect(crystallize.mock.calls[0]).toEqual(['Log in', 'auth flow', expect.any(Array), expect.any(Array)]);
    expect((crystallize.mock.calls[0][2] as SkillStep[])).toHaveLength(1);
    expect((crystallize.mock.calls[0][3] as unknown[])).toHaveLength(0); // no password fill → no redactions
    expect(c.steps).toHaveLength(0); // buffer cleared for the next flow
  });

  it('redacts a value typed into a password field to a HOVER_PASSWORD env ref', async () => {
    const page = mockPage({ fieldType: 'password' });
    const crystallize = vi.fn(async () => ({ path: '/p/__vibe_tests__/login.spec.ts' }));
    const c = new HoverMcpController({ getPage: async () => page, crystallize });
    await c.fill({ role: 'textbox', name: 'Password' }, 'hunter2');
    await c.crystallize('Log in');
    const redactions = crystallize.mock.calls[0][3] as Array<{ value: string; envVar: string }>;
    expect(redactions).toEqual([{ value: 'hunter2', envVar: 'HOVER_PASSWORD' }]);
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
    expect(recordFact).toHaveBeenCalledWith('guests cannot checkout', 'must log in before checkout', 'business-rule', undefined);
    expect(await c.recall()).toContain('guests cannot checkout');
  });

  it('record_fact threads the optional business line through to the writer', async () => {
    const recordFact = vi.fn(async () => ({ path: 'x' }));
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }), recordFact });
    expect(
      await c.recordFact('login needs auth', 'practice redirects anon users to /login', 'access-policy', 'Log in'),
    ).toContain('(on Log in)');
    expect(recordFact).toHaveBeenCalledWith('login needs auth', 'practice redirects anon users to /login', 'access-policy', 'Log in');
  });

  it('record_fact / recall degrade gracefully when the deps are absent', async () => {
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }) });
    expect(await c.recordFact('t', 'r')).toContain('unavailable');
    expect(await c.recall()).toContain('No business memory');
  });

  it('recall_fact returns a matched rule body, or points back to the index on a miss', async () => {
    const recallFact = vi.fn(async (name: string) => (name === 'checkout-tax' ? 'checkout-tax — VAT (business-rule):\nincludes 20% VAT' : null));
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }), recallFact });
    expect(await c.recallFact('checkout-tax')).toContain('20% VAT');
    const miss = await c.recallFact('ghost');
    expect(miss).toContain('No remembered rule matches');
    expect(miss).toContain('recall_business_knowledge'); // points back to the index
  });

  it('recall_fact degrades gracefully when the dep is absent', async () => {
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }) });
    expect(await c.recallFact('anything')).toContain('unavailable');
  });

  it('optimizeBrief returns the brief prompt, and a helpful message on a missing spec', async () => {
    const optimizeBrief = vi.fn(async (slug: string) =>
      slug === 'checkout' ? { prompt: 'IMPROVE THIS SPEC ...' } : { error: 'spec not found' });
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }), optimizeBrief });

    expect(await c.optimizeBrief('checkout')).toBe('IMPROVE THIS SPEC ...');
    const missing = await c.optimizeBrief('ghost');
    expect(missing).toContain('spec not found');
    expect(missing).toContain('crystallized spec'); // never throws → the prompt still renders
  });

  it('saveOptimized files the candidate; a rejected result throws (→ ✗ the agent can retry)', async () => {
    const saveOptimized = vi.fn(async (slug: string, code: string) => {
      if (code.includes('waitForTimeout')) throw new Error('optimization rejected — uses waitForTimeout');
      return { candidatePath: `/p/.hover/cache/optimized/${slug}.spec.ts.draft` };
    });
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }), saveOptimized });

    const ok = await c.saveOptimized('checkout', 'await expect(x).toBeVisible();');
    expect(ok).toContain('checkout.spec.ts.draft');
    expect(ok).toContain('untouched');
    await expect(c.saveOptimized('checkout', 'await page.waitForTimeout(1);')).rejects.toThrow('rejected');
  });

  it('optimize degrades gracefully when the deps are absent', async () => {
    const c = new HoverMcpController({ getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }) });
    expect(await c.optimizeBrief('checkout')).toContain('unavailable');
    expect(await c.saveOptimized('checkout', 'code')).toContain('unavailable');
  });

  it('lintWiki renders findings, a clean pass, and a no-map message', async () => {
    const base = { getPage: async () => mockPage(), crystallize: async () => ({ path: 'x' }) };
    const withFindings = new HoverMcpController({ ...base, lintWiki: async () => ({
      ok: false, hasMap: true,
      findings: [{ kind: 'regressed-coverage' as const, severity: 'warn' as const, line: 'Checkout', spec: 'checkout.spec.ts', message: 'Checkout regressed', fix: '/mcp__hover__heal checkout' }],
      summary: { areas: 1, lines: 2, covered: 1, specs: 3 },
    }) });
    const out = await withFindings.lintWiki();
    expect(out).toContain('1/2 lines covered');
    expect(out).toContain('⚠ [regressed-coverage]');
    expect(out).toContain('/mcp__hover__heal checkout');

    const clean = new HoverMcpController({ ...base, lintWiki: async () => ({
      ok: true, hasMap: true, findings: [], summary: { areas: 1, lines: 1, covered: 1, specs: 1 },
    }) });
    expect(await clean.lintWiki()).toContain('No drift');

    const empty = new HoverMcpController({ ...base, lintWiki: async () => ({
      ok: true, hasMap: false, findings: [], summary: { areas: 0, lines: 0, covered: 0, specs: 0 },
    }) });
    expect(await empty.lintWiki()).toContain('test_app first');

    const absent = new HoverMcpController(base);
    expect(await absent.lintWiki()).toContain('unavailable');
  });

  it('assert_visible throws (→ ✗ to the agent) when the target is not visible', async () => {
    const c = new HoverMcpController({ getPage: async () => mockPage({ visible: false }), crystallize: async () => ({ path: 'x' }) });
    await expect(c.assertVisible({ text: 'Welcome' })).rejects.toThrow('not visible');
    expect(c.steps).toHaveLength(0); // a failed assert is not buffered
  });
});

describe('verifySpecs', () => {
  const mkSteps = (): SkillStep[] => [
    { kind: 'step', tool: 'click_control', input: { role: 'button', name: 'Sign in' } } as unknown as SkillStep,
  ];

  it('fast mode replays each runnable spec and aggregates pass results', async () => {
    const page = mockPage();
    const c = new HoverMcpController({
      getPage: async () => page,
      crystallize: async () => ({ path: '/p/x.spec.ts' }),
      readSpecSteps: async (slug) => ({ steps: mkSteps(), startUrl: 'http://app', redactionEnvVars: [] }),
      listSpecSlugs: async () => ['checkout', 'log-in'],
    });
    const out = JSON.parse(await c.verifySpecs());
    expect(out.mode).toBe('fast');
    expect(out.summary).toEqual({ pass: 2, failed: 0, blocked: 0 });
    expect(out.note).toMatch(/CI remains the source of truth/);
  });

  it('blocks a spec with missing credential env vars without touching the browser', async () => {
    let pageRequested = false;
    const c = new HoverMcpController({
      getPage: async () => {
        pageRequested = true;
        return mockPage();
      },
      crystallize: async () => ({ path: '/p/x.spec.ts' }),
      readSpecSteps: async () => ({ steps: mkSteps(), redactionEnvVars: ['HOVER_NOPE_PASS'] }),
    });
    delete process.env.HOVER_NOPE_PASS;
    const out = JSON.parse(await c.verifySpecs(['log-in']));
    expect(out.summary).toEqual({ pass: 0, failed: 0, blocked: 1 });
    expect(out.results[0].reason).toMatch(/HOVER_NOPE_PASS.*NOT drift/s);
    expect(pageRequested).toBe(false);
  });

  it('faithful mode maps runner results and keeps blocked preflights', async () => {
    const c = new HoverMcpController({
      getPage: async () => mockPage(),
      crystallize: async () => ({ path: '/p/x.spec.ts' }),
      readSpecSteps: async (slug) =>
        slug === 'locked'
          ? { steps: mkSteps(), redactionEnvVars: ['HOVER_LOCKED_PASS'] }
          : { steps: mkSteps(), redactionEnvVars: [] },
      runSpecTests: async (slugs) => ({
        results: slugs.map((s) => (s === 'checkout' ? { spec: s, status: 'pass' as const } : { spec: s, status: 'fail' as const, error: 'expect failed' })),
      }),
    });
    delete process.env.HOVER_LOCKED_PASS;
    const out = JSON.parse(await c.verifySpecs(['checkout', 'cart', 'locked'], 'faithful'));
    expect(out.summary).toEqual({ pass: 1, failed: 1, blocked: 1 });
    const byStatus = Object.fromEntries(out.results.map((r: { spec: string; status: string }) => [r.spec, r.status]));
    expect(byStatus).toEqual({ checkout: 'pass', cart: 'fail', locked: 'blocked' });
  });
});
