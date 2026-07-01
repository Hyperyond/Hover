import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintWiki, parseRunStatuses } from '../../src/specs/lintWiki.js';
import { parseBusinessMap } from '../../src/specs/businessMap.js';

describe('parseBusinessMap', () => {
  it('parses areas, coverage marks, routes, and spec refs', () => {
    const g = parseBusinessMap(`# Business map — Shop
## Auth
- [ ] Log in — /login
- [x] Checkout — /checkout — checkout.spec.ts
`);
    expect(g.app).toBe('Shop');
    expect(g.stats).toEqual({ lines: 2, covered: 1, areas: 1 });
    const line = g.nodes.find((n) => n.kind === 'line' && n.label === 'Checkout');
    expect(line?.status).toBe('covered');
    expect(line?.route).toBe('/checkout');
    expect(line?.spec).toBe('checkout.spec.ts');
  });
});

describe('parseRunStatuses', () => {
  it('reduces a Playwright report to worst-status per spec basename', () => {
    const json = {
      suites: [
        { file: '__vibe_tests__/checkout.spec.ts', specs: [{ ok: false, tests: [{ status: 'unexpected' }] }] },
        { file: '__vibe_tests__/login.spec.ts', specs: [{ ok: true, tests: [{ status: 'flaky' }] }] },
      ],
    };
    expect(parseRunStatuses(json)).toEqual({ 'checkout.spec.ts': 'fail', 'login.spec.ts': 'flaky' });
  });
  it('is total on a bad shape', () => {
    expect(parseRunStatuses(null)).toEqual({});
    expect(parseRunStatuses({ nope: 1 })).toEqual({});
  });
});

describe('lintWiki', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lint-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const map = (md: string) => writeFile(join(dir, '.hover', 'hover-map.md'), md, 'utf-8');
  const spec = (name: string) => writeFile(join(dir, '__vibe_tests__', name), '// spec', 'utf-8');
  const run = (name: string, json: unknown) => writeFile(join(dir, '.hover', 'runs', name), JSON.stringify(json), 'utf-8');
  const pwRun = (file: string, ok: boolean) => ({ suites: [{ file, specs: [{ ok, tests: [{ status: ok ? 'expected' : 'unexpected' }] }] }] });

  beforeEach(async () => {
    await mkdir(join(dir, '.hover', 'runs'), { recursive: true });
    await mkdir(join(dir, '__vibe_tests__'), { recursive: true });
  });

  it('reports no findings on a healthy wiki', async () => {
    await spec('checkout.spec.ts');
    await map(`# Business map — Shop\n## Buy\n- [x] Checkout — /checkout — checkout.spec.ts\n`);
    const res = await lintWiki(dir);
    expect(res.hasMap).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.findings).toHaveLength(0);
    expect(res.summary).toMatchObject({ areas: 1, lines: 1, covered: 1, specs: 1 });
  });

  it('flags a deleted spec a line still points at', async () => {
    await map(`# Business map — Shop\n## Buy\n- [x] Checkout — /checkout — checkout.spec.ts\n`);
    const res = await lintWiki(dir);
    const f = res.findings.find((x) => x.kind === 'deleted-spec');
    expect(f?.severity).toBe('error');
    expect(f?.spec).toBe('checkout.spec.ts');
    expect(res.ok).toBe(false);
  });

  it('flags regressed coverage (a covered line whose spec last ran fail)', async () => {
    await spec('checkout.spec.ts');
    await map(`# Business map — Shop\n## Buy\n- [x] Checkout — /checkout — checkout.spec.ts\n`);
    await run('2026-06-30T10-00-00.json', pwRun('__vibe_tests__/checkout.spec.ts', true));
    await run('2026-07-01T10-00-00.json', pwRun('__vibe_tests__/checkout.spec.ts', false)); // latest = fail
    const res = await lintWiki(dir);
    const f = res.findings.find((x) => x.kind === 'regressed-coverage');
    expect(f?.severity).toBe('warn');
    expect(f?.fix).toContain('/mcp__hover__heal checkout');
    expect(res.ok).toBe(false);
  });

  it('does not flag regression when the LATEST run passed', async () => {
    await spec('checkout.spec.ts');
    await map(`# Business map — Shop\n## Buy\n- [x] Checkout — /checkout — checkout.spec.ts\n`);
    await run('2026-06-30T10-00-00.json', pwRun('__vibe_tests__/checkout.spec.ts', false));
    await run('2026-07-01T10-00-00.json', pwRun('__vibe_tests__/checkout.spec.ts', true)); // latest = pass
    const res = await lintWiki(dir);
    expect(res.findings.some((x) => x.kind === 'regressed-coverage')).toBe(false);
  });

  it('flags an orphan UI spec no line maps, but not an api-test spec', async () => {
    await spec('checkout.spec.ts');
    await spec('orphan.spec.ts');
    await spec('cart.api-test.spec.ts');
    await map(`# Business map — Shop\n## Buy\n- [x] Checkout — /checkout — checkout.spec.ts\n`);
    const res = await lintWiki(dir);
    const orphans = res.findings.filter((x) => x.kind === 'orphan-spec');
    expect(orphans.map((o) => o.spec)).toEqual(['orphan.spec.ts']); // api-test excluded
    expect(res.ok).toBe(true); // orphan is info-only
  });

  it('returns hasMap:false when there is no map', async () => {
    const res = await lintWiki(dir);
    expect(res.hasMap).toBe(false);
    expect(res.findings).toHaveLength(0);
  });
});
