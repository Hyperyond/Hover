import { describe, expect, it, vi } from 'vitest';
import { fetchDashboard } from '../src/cloud.js';
import {
  actionsRunId,
  buildDashboard,
  cellsFlaky,
  dashboardRunSlices,
  isSecuritySpec,
  mergeRunSlices,
  parsePlaywrightRun,
  specGroup,
  worse,
  type DashboardData,
  type RunSlice,
  type SpecFileRef,
  type Status,
} from '../src/dashboard.js';

describe('worse', () => {
  it('ranks fail > flaky > pass and seeds from undefined', () => {
    expect(worse(undefined, 'pass')).toBe('pass');
    expect(worse('pass', 'flaky')).toBe('flaky');
    expect(worse('flaky', 'fail')).toBe('fail');
    expect(worse('fail', 'pass')).toBe('fail');
  });
});

describe('cellsFlaky', () => {
  it('flags an explicit flaky run and a pass/fail mix; nulls are ignored', () => {
    expect(cellsFlaky(['pass', null, 'flaky'])).toBe(true);
    expect(cellsFlaky(['pass', 'fail'])).toBe(true);
    expect(cellsFlaky(['pass', null, 'pass'])).toBe(false);
    expect(cellsFlaky(['fail', 'fail'])).toBe(false);
  });
});

describe('specGroup', () => {
  it('takes the folders between __vibe_tests__ and the file, on any separator', () => {
    expect(specGroup('/repo/__vibe_tests__/auth/login.spec.ts')).toBe('auth');
    expect(specGroup('__vibe_tests__/a/b/c.spec.ts')).toBe('a/b');
    expect(specGroup('C:\\repo\\__vibe_tests__\\auth\\login.spec.ts')).toBe('auth');
    expect(specGroup('__vibe_tests__/top.spec.ts')).toBe('');
    expect(specGroup('src/other/thing.ts')).toBe('');
  });
});

describe('isSecuritySpec', () => {
  it('matches only the .api-test.spec.ts suffix', () => {
    expect(isSecuritySpec('login.api-test.spec.ts')).toBe(true);
    expect(isSecuritySpec('login.spec.ts')).toBe(false);
  });
});

describe('parsePlaywrightRun', () => {
  it('keys by basename, marks flaky retries, and collapses duplicates worst-wins', () => {
    const report = {
      suites: [
        {
          file: '__vibe_tests__/checkout.spec.ts',
          specs: [
            { ok: true, tests: [{ status: 'expected' }] },
            { ok: true, tests: [{ status: 'flaky' }] }, // same file → worst wins
          ],
          suites: [
            {
              // inherits the parent file when a nested suite has none
              specs: [{ ok: false, tests: [{ status: 'unexpected' }] }],
            },
          ],
        },
        {
          file: 'login.spec.ts',
          specs: [{ ok: true, tests: [{ status: 'expected' }] }],
        },
      ],
    };
    expect(parsePlaywrightRun(report)).toEqual({
      'checkout.spec.ts': 'fail',
      'login.spec.ts': 'pass',
    } satisfies Record<string, Status>);
  });

  it('yields nothing on an unexpected shape', () => {
    expect(parsePlaywrightRun({})).toEqual({});
    expect(parsePlaywrightRun(null)).toEqual({});
  });
});

describe('dashboardRunSlices', () => {
  it('recovers per-run specs maps from rows/cells', () => {
    const data: DashboardData = {
      hasRuns: true,
      tiles: { specs: 2, passRate: 50, flaky: 0, tokens7d: null },
      runs: [
        { id: 'r1', ts: '2026-07-01T00:00:00.000Z' },
        { id: 'r2', ts: '2026-07-02T00:00:00.000Z', ciUrl: 'https://github.com/o/r/actions/runs/42' },
      ],
      rows: [
        { name: 'a.spec.ts', path: null, group: '', security: false, cells: ['pass', 'fail'], flaky: true },
        { name: 'b.spec.ts', path: null, group: '', security: false, cells: [null, 'pass'], flaky: false },
      ],
    };
    expect(dashboardRunSlices(data)).toEqual([
      { id: 'r1', ts: '2026-07-01T00:00:00.000Z', specs: { 'a.spec.ts': 'pass' } },
      {
        id: 'r2',
        ts: '2026-07-02T00:00:00.000Z',
        ciUrl: 'https://github.com/o/r/actions/runs/42',
        specs: { 'a.spec.ts': 'fail', 'b.spec.ts': 'pass' },
      },
    ]);
  });
});

describe('actionsRunId', () => {
  it('extracts the Actions run id from a CI deep link', () => {
    expect(actionsRunId('https://github.com/o/r/actions/runs/1234567/attempts/2')).toBe('1234567');
    expect(actionsRunId('https://example.com/other')).toBeNull();
    expect(actionsRunId(null)).toBeNull();
  });
});

describe('mergeRunSlices', () => {
  const slice = (id: string, ts: string, extra: Partial<RunSlice> = {}): RunSlice => ({
    id,
    ts,
    specs: {},
    ...extra,
  });

  it('interleaves by timestamp and keeps the cloud copy of a locally-synced CI run', () => {
    const local = [
      slice('2026-07-01T08-00-00', '2026-07-01T08:00:00Z'),
      slice('ci-42', 'ci-42'), // synced from CI → same run as the cloud's r2
    ];
    const cloud = [
      slice('r2', '2026-07-01T12:00:00Z', { ciUrl: 'https://github.com/o/r/actions/runs/42' }),
      slice('r3', '2026-07-02T09:00:00Z', { ciUrl: 'https://github.com/o/r/actions/runs/43' }),
    ];
    expect(mergeRunSlices(local, cloud).map((r) => r.id)).toEqual([
      '2026-07-01T08-00-00',
      'r2',
      'r3',
    ]);
  });

  it('caps at MAX_RUNS keeping the newest', () => {
    const local = Array.from({ length: 10 }, (_, i) =>
      slice(`l${i}`, `2026-06-${String(i + 10).padStart(2, '0')}T00:00:00Z`),
    );
    const cloud = Array.from({ length: 10 }, (_, i) =>
      slice(`c${i}`, `2026-07-${String(i + 10).padStart(2, '0')}T00:00:00Z`),
    );
    const merged = mergeRunSlices(local, cloud);
    expect(merged).toHaveLength(14);
    expect(merged[0].id).toBe('l6'); // 6 oldest local runs dropped
    expect(merged[13].id).toBe('c9');
  });
});

describe('buildDashboard', () => {
  it('unions catalogue + run-history specs, computes tiles, and strips specs off run entries', () => {
    const runs: RunSlice[] = [
      { id: 'r1', ts: '2026-07-01T00:00:00Z', specs: { 'a.spec.ts': 'pass', 'gone.spec.ts': 'fail' } },
      {
        id: 'r2',
        ts: '2026-07-02T00:00:00Z',
        ciUrl: 'https://ci',
        branch: 'main',
        specs: { 'a.spec.ts': 'fail', 'gone.spec.ts': 'fail' },
      },
    ];
    const files = new Map<string, SpecFileRef>([
      ['a.spec.ts', { path: '/repo/__vibe_tests__/auth/a.spec.ts' }],
      ['fresh.spec.ts', { path: '/repo/__vibe_tests__/fresh.spec.ts' }], // never ran
      ['cloudy.spec.ts', { path: null, specFile: '__vibe_tests__/x/cloudy.spec.ts' }],
    ]);

    const data = buildDashboard(runs, files, 1234, 2);

    expect(data.hasRuns).toBe(true);
    expect(data.tiles).toEqual({ specs: 2, passRate: 0, flaky: 1, tokens7d: 1234 });
    expect(data.runs).toEqual([
      { id: 'r1', ts: '2026-07-01T00:00:00Z' },
      { id: 'r2', ts: '2026-07-02T00:00:00Z', ciUrl: 'https://ci', branch: 'main' },
    ]);
    expect(data.rows.map((r) => r.name)).toEqual([
      'a.spec.ts',
      'cloudy.spec.ts',
      'fresh.spec.ts',
      'gone.spec.ts',
    ]);

    const a = data.rows[0];
    expect(a).toMatchObject({ path: '/repo/__vibe_tests__/auth/a.spec.ts', group: 'auth', cells: ['pass', 'fail'], flaky: true });
    expect(data.rows[1]).toMatchObject({ path: null, specFile: '__vibe_tests__/x/cloudy.spec.ts', group: 'x', cells: [null, null] });
    expect(data.rows[2]).toMatchObject({ group: '', cells: [null, null], flaky: false });
    expect(data.rows[3]).toMatchObject({ path: null, group: '', cells: ['fail', 'fail'], flaky: false });
  });

  it('returns an empty dashboard for no runs and no files', () => {
    expect(buildDashboard([], new Map(), null)).toEqual({
      hasRuns: false,
      tiles: { specs: 0, passRate: null, flaky: 0, tokens7d: null },
      runs: [],
      rows: [],
    });
  });
});

describe('fetchDashboard', () => {
  it('GETs /api/v1/dashboard with auth + repo and unwraps the payload', async () => {
    const dashboard = {
      hasRuns: false,
      tiles: { specs: 0, passRate: null, flaky: 0, tokens7d: null },
      runs: [],
      rows: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ dashboard }), { status: 200 }));
    const data = await fetchDashboard(
      { token: 'hover_pat_x', url: 'https://cloud.example.com' },
      'o/r',
      fetchImpl,
    );
    expect(data).toEqual(dashboard);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://cloud.example.com/api/v1/dashboard?repo=o%2Fr');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hover_pat_x');
  });
});
