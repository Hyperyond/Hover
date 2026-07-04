/**
 * Dashboard data contract (v1) + the pure helpers that compute it.
 *
 * ONE shape feeds every dashboard surface: the VS Code webview panel builds it
 * from local `.hover/runs/*.json` (see vscode-ext/src/dashboardView.ts) and
 * Hover Cloud's `GET /api/v1/dashboard` emits the same shape from ingested CI
 * runs — so the panel can swap data sources without a UI change. The cloud
 * route (Hover-cloud repo, apps/dashboard/app/api/v1/dashboard/route.ts)
 * mirrors this contract; change it here first, then there.
 *
 * Everything in this module is pure (no vscode, no fs) so the extension, the
 * MCP server, and tests can all use it.
 */

export type Status = 'pass' | 'fail' | 'flaky';

/** How many recent runs a dashboard shows (the run-history strip width). */
export const MAX_RUNS = 14;

export interface SpecRow {
  /** Spec basename, e.g. `checkout.spec.ts` — the row identity. */
  name: string;
  /** Absolute local fsPath for open/run actions. Local source only; cloud → null. */
  path: string | null;
  /** Repo-relative spec file path. Cloud source only; local → omitted. */
  specFile?: string;
  /** Folder group under `__vibe_tests__/` ('' = top level). */
  group: string;
  security: boolean;
  /** One cell per entry in `runs` (null = spec not part of that run). */
  cells: (Status | null)[];
  /** Inconsistent across the window — a candidate for 🏥 Heal. */
  flaky: boolean;
}

export interface DashboardRun {
  id: string;
  /** ISO-ish timestamp label (local: the run filename stamp; cloud: createdAt). */
  ts: string;
  /** Deep link back to the user's CI. Cloud source only. */
  ciUrl?: string | null;
  branch?: string | null;
  /** Which environment the run targeted (`local` / `staging` / `prod` / `ci`) —
   *  the Environments-view id the reporter tagged the run with. Cloud source only. */
  environment?: string | null;
}

export interface DashboardData {
  hasRuns: boolean;
  tiles: {
    specs: number;
    /** Pass rate (%) of the latest run; null when there are no runs. */
    passRate: number | null;
    flaky: number;
    /** 7-day agent token spend. Local source only; cloud → null. */
    tokens7d: number | null;
  };
  runs: DashboardRun[];
  rows: SpecRow[];
  /** Distinct environments the project has runs for (cloud source only) — the
   *  Remote view's environment filter. Omitted/undefined for the local source. */
  environments?: string[];
}

/** One run as a computable unit: its column header + per-spec statuses. The
 *  local gatherer parses these from `.hover/runs/*.json`; `dashboardRunSlices`
 *  recovers them from a cloud `DashboardData`. */
export interface RunSlice extends DashboardRun {
  specs: Record<string, Status>;
}

/** Where a spec row's file lives — local absolute path and/or repo-relative. */
export interface SpecFileRef {
  path: string | null;
  specFile?: string;
}

/** Worst-wins ranking when a single run file reports several specs in one file. */
export function worse(a: Status | undefined, b: Status): Status {
  const rank: Record<Status, number> = { pass: 0, flaky: 1, fail: 2 };
  if (!a) return b;
  return rank[b] > rank[a] ? b : a;
}

/** Flaky = a spec that both passed and failed across the window (or a run marked
 *  it flaky on retry). Shared by the per-row flag and the aggregate tile. */
export function cellsFlaky(cells: (Status | null)[]): boolean {
  const seen = new Set(cells.filter(Boolean));
  return seen.has('flaky') || (seen.has('pass') && seen.has('fail'));
}

/** Security specs get a shield in every surface — one naming rule. */
export function isSecuritySpec(name: string): boolean {
  return name.endsWith('.api-test.spec.ts');
}

/** Folder segments between the nearest `__vibe_tests__` and the file (excl. the
 *  filename), joined by '/'. `__vibe_tests__/auth/login.spec.ts` → 'auth'.
 *  Works on both absolute fsPaths and repo-relative paths. */
export function specGroup(path: string): string {
  const parts = path.split(/[\\/]/);
  const idx = parts.lastIndexOf('__vibe_tests__');
  return idx >= 0 ? parts.slice(idx + 1, -1).join('/') : '';
}

/** Recover per-run slices from a `DashboardData` (rows/cells → specs maps) —
 *  how a cloud dashboard becomes mergeable with locally-gathered runs. */
export function dashboardRunSlices(data: DashboardData): RunSlice[] {
  return data.runs.map((run, i) => {
    const specs: Record<string, Status> = {};
    for (const row of data.rows) {
      const cell = row.cells[i];
      if (cell) specs[row.name] = cell;
    }
    return { ...run, specs };
  });
}

/** The GitHub Actions run id inside a CI deep link, or null. Matches the
 *  `ci-<id>.json` ledger naming the extension's CI sync uses — the dedup key
 *  between a locally-synced CI run and the same run ingested by the cloud. */
export function actionsRunId(ciUrl: string | null | undefined): string | null {
  return ciUrl?.match(/\/actions\/runs\/(\d+)/)?.[1] ?? null;
}

/** Merge locally-gathered runs with cloud-ingested ones into one chronological
 *  timeline, newest-last, capped at MAX_RUNS. A CI run present on both sides
 *  (a `ci-<id>` local ledger vs the cloud run's `ciUrl`) keeps the CLOUD copy —
 *  it carries the real timestamp + deep link. Unparseable timestamps sort
 *  oldest, preserving their relative order (Array.sort is stable). */
export function mergeRunSlices(local: RunSlice[], cloud: RunSlice[]): RunSlice[] {
  const cloudCiIds = new Set(cloud.map((r) => actionsRunId(r.ciUrl)).filter(Boolean));
  const keptLocal = local.filter((r) => !cloudCiIds.has(r.id.replace(/^ci-/, '')));
  const key = (r: RunSlice) => {
    const t = Date.parse(r.ts);
    return Number.isNaN(t) ? 0 : t;
  };
  return [...keptLocal, ...cloud].sort((a, b) => key(a) - key(b)).slice(-MAX_RUNS);
}

/** Assemble the final `DashboardData` from run slices (chronological) + the
 *  known spec files. `files` seeds the rows (a catalogue spec with no runs yet
 *  still shows) and supplies open/run paths; specs seen only in run history get
 *  a path-less row. `specCount` overrides the specs tile when the caller has a
 *  better catalogue count than `files.size`. */
export function buildDashboard(
  runs: RunSlice[],
  files: Map<string, SpecFileRef>,
  tokens7d: number | null,
  specCount: number = files.size,
): DashboardData {
  const names = new Set<string>(files.keys());
  for (const r of runs) for (const k of Object.keys(r.specs)) names.add(k);

  const rows: SpecRow[] = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const ref = files.get(name);
      const cells = runs.map((r) => r.specs[name] ?? null);
      return {
        name,
        path: ref?.path ?? null,
        ...(ref?.specFile ? { specFile: ref.specFile } : {}),
        group: specGroup(ref?.path ?? ref?.specFile ?? ''),
        security: isSecuritySpec(name),
        cells,
        flaky: cellsFlaky(cells),
      };
    });

  let passRate: number | null = null;
  const last = runs[runs.length - 1];
  if (last) {
    const vals = Object.values(last.specs);
    if (vals.length) passRate = Math.round((vals.filter((s) => s === 'pass').length / vals.length) * 100);
  }

  return {
    hasRuns: runs.length > 0,
    tiles: { specs: specCount, passRate, flaky: rows.filter((r) => r.flaky).length, tokens7d },
    runs: runs.map(({ specs: _specs, ...run }) => run),
    rows,
  };
}

/** Parse a Playwright json report into { specBasename → status }. Defensive:
 *  an unexpected shape just yields no entries. */
export function parsePlaywrightRun(json: unknown): Record<string, Status> {
  const out: Record<string, Status> = {};
  const visit = (suite: { file?: string; specs?: unknown[]; suites?: unknown[] }, inherited?: string): void => {
    const file = suite.file ?? inherited;
    for (const raw of suite.specs ?? []) {
      const spec = raw as { ok?: boolean; tests?: { status?: string }[]; file?: string };
      const key = (file ?? spec.file ?? 'unknown').split(/[\\/]/).pop() ?? 'unknown';
      let status: Status = spec.ok ? 'pass' : 'fail';
      if (spec.ok && (spec.tests ?? []).some((t) => t.status === 'flaky')) status = 'flaky';
      out[key] = worse(out[key], status);
    }
    for (const child of suite.suites ?? []) visit(child as typeof suite, file);
  };
  for (const s of (json as { suites?: unknown[] } | null)?.suites ?? []) visit(s as Parameters<typeof visit>[0]);
  return out;
}
