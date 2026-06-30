/**
 * The Hover "Dashboard" — the single sidebar surface for specs. It merges what
 * used to be two views (the spec×run health matrix AND the Specs file tree):
 *
 *   - Run all + a search box at the top.
 *   - Health tiles (spec count, last pass rate, flaky, 7-day token spend).
 *   - One row per crystallized spec (folder-grouped, mirroring `__vibe_tests__/`)
 *     showing its recent-run pass/fail strip + per-spec ▶ Run / ✨ Optimize
 *     actions; click the name to open the file. Security specs get a shield.
 *
 * Data sources under `.hover/`:
 *   - `.hover/runs/*.json`  — Playwright json reports (▶ Run). → the per-spec
 *     recent-run strip + flakiness.
 *   - `.hover/sessions/*.json` — agent authoring runs. → 7-day token spend.
 *   - the spec catalogue under `__vibe_tests__/`. → the rows + actions.
 *
 * Webview (not a TreeView) because the coloured run-history strip can't be drawn
 * with TreeItems — and folding the Specs tree in here is exactly what removed
 * the separate view. Read-only over a plain `DashboardData` model so a Cloud
 * API can later feed the same webview (see project-hover-cloud-direction).
 */
import * as vscode from 'vscode';
import { renderWebviewHtml } from './webviewHost.js';

export type Status = 'pass' | 'fail' | 'flaky';

interface SpecRow {
  name: string;
  /** Absolute fsPath, or null for a spec seen only in run history (file gone). */
  path: string | null;
  /** Folder group under `__vibe_tests__/` ('' = top level). */
  group: string;
  security: boolean;
  cells: (Status | null)[];
  /** Inconsistent across the window (both passed and failed, or a flaky run) —
   *  a candidate for 🏥 Heal. */
  flaky: boolean;
}

/** Flaky = a spec that both passed and failed across the window (or a run marked
 *  it flaky on retry). Shared by the per-row flag and the aggregate tile. */
function cellsFlaky(cells: (Status | null)[]): boolean {
  const seen = new Set(cells.filter(Boolean));
  return seen.has('flaky') || (seen.has('pass') && seen.has('fail'));
}

interface DashboardData {
  hasRuns: boolean;
  tiles: { specs: number; passRate: number | null; flaky: number; tokens7d: number };
  runs: { id: string; ts: string }[];
  rows: SpecRow[];
}

const MAX_RUNS = 14;

/** Worst-wins ranking when a single run file reports several specs in one file. */
function worse(a: Status | undefined, b: Status): Status {
  const rank: Record<Status, number> = { pass: 0, flaky: 1, fail: 2 };
  if (!a) return b;
  return rank[b] > rank[a] ? b : a;
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
  for (const s of (json as { suites?: unknown[] }).suites ?? []) visit(s as Parameters<typeof visit>[0]);
  return out;
}

async function readJson(uri: vscode.Uri): Promise<unknown | null> {
  try {
    return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8'));
  } catch {
    return null;
  }
}

/** Folder segments between the nearest `__vibe_tests__` and the file (excl. the
 *  filename), joined by '/'. `__vibe_tests__/auth/login.spec.ts` → 'auth'. */
function specGroup(fsPath: string): string {
  const parts = fsPath.split(/[\\/]/);
  const idx = parts.lastIndexOf('__vibe_tests__');
  return idx >= 0 ? parts.slice(idx + 1, -1).join('/') : '';
}

async function gather(): Promise<DashboardData> {
  const specUris = await vscode.workspace.findFiles('**/__vibe_tests__/**/*.spec.ts', '**/node_modules/**');
  // basename → its file (for actions / open). Multiple specs can't share a
  // basename across folders in practice; last one wins, which is fine for the
  // run-history lookup keyed by basename.
  const byName = new Map<string, vscode.Uri>();
  for (const u of specUris) byName.set(u.path.split('/').pop() ?? '', u);

  const runUris = (await vscode.workspace.findFiles('**/.hover/runs/*.json', '**/node_modules/**'))
    .sort((a, b) => a.path.localeCompare(b.path)) // filename is the ISO stamp → chronological
    .slice(-MAX_RUNS);
  const runs: { id: string; ts: string; specs: Record<string, Status> }[] = [];
  for (const uri of runUris) {
    const json = await readJson(uri);
    if (!json) continue;
    const id = (uri.path.split('/').pop() ?? '').replace(/\.json$/, '');
    runs.push({ id, ts: id, specs: parsePlaywrightRun(json) });
  }

  // Rows = catalogue specs ∪ any spec seen in a run. Each cell = that spec's
  // status in that run (null = not part of that run).
  const allNames = new Set<string>(byName.keys());
  for (const r of runs) for (const k of Object.keys(r.specs)) allNames.add(k);
  const rows: SpecRow[] = [...allNames]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const uri = byName.get(name);
      const cells = runs.map((r) => r.specs[name] ?? null) as (Status | null)[];
      return {
        name,
        path: uri ? uri.fsPath : null,
        group: uri ? specGroup(uri.fsPath) : '',
        security: name.endsWith('.api-test.spec.ts'),
        cells,
        flaky: cellsFlaky(cells),
      };
    });

  const flaky = rows.filter((r) => r.flaky).length;

  // Pass rate of the latest run.
  let passRate: number | null = null;
  const last = runs[runs.length - 1];
  if (last) {
    const vals = Object.values(last.specs);
    if (vals.length) passRate = Math.round((vals.filter((s) => s === 'pass').length / vals.length) * 100);
  }

  // Agent runs (one meta.json per run, grouped by conversation) → 7-day token spend.
  const sessUris = (await vscode.workspace.findFiles('**/.hover/conversations/*/*/meta.json', '**/node_modules/**'))
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(0, 40);
  const weekAgo = Date.now() - 7 * 864e5;
  let tokens7d = 0;
  for (const uri of sessUris) {
    const s = (await readJson(uri)) as { tokensUsed?: number; startedAt?: string } | null;
    if (!s) continue;
    const started = s.startedAt ? Date.parse(s.startedAt) : NaN;
    if (typeof s.tokensUsed === 'number' && (Number.isNaN(started) || started >= weekAgo)) tokens7d += s.tokensUsed;
  }

  return {
    hasRuns: runs.length > 0,
    tiles: { specs: byName.size, passRate, flaky, tokens7d },
    runs: runs.map((r) => ({ id: r.id, ts: r.ts })),
    rows,
  };
}

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.dashboard';
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'dashboard');
    view.webview.onDidReceiveMessage((msg: { type: string; path?: string }) => {
      if (msg.type === 'ready' || msg.type === 'refresh') void this.push();
      else if (msg.type === 'runAll') void vscode.commands.executeCommand('hover.runAllSpecs');
      else if (msg.type === 'runSpec' && msg.path) void vscode.commands.executeCommand('hover.runSpec', vscode.Uri.file(msg.path));
      else if (msg.type === 'syncCi') void vscode.commands.executeCommand('hover.syncCiResults');
      else if (msg.type === 'open' && msg.path) void vscode.window.showTextDocument(vscode.Uri.file(msg.path));
      else if (msg.type === 'installMcp') void vscode.commands.executeCommand('hover.installMcp');
      else if (msg.type === 'openSite') void vscode.commands.executeCommand('hover.openSite');
    });
  }

  refresh(): void {
    void this.push();
  }

  private async push(): Promise<void> {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'data', data: await gather() });
  }

}

/** Register the Dashboard view + a refresh command + file watchers that keep it
 *  live as runs / sessions / specs change. Returns disposables. */
export function registerDashboardView(extensionUri: vscode.Uri): vscode.Disposable[] {
  const provider = new DashboardViewProvider(extensionUri);
  const view = vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  const refresh = vscode.commands.registerCommand('hover.refreshDashboard', () => provider.refresh());
  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/{runs/*.json,conversations/**}');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  const specs = vscode.workspace.createFileSystemWatcher('**/__vibe_tests__/**/*.spec.ts');
  specs.onDidCreate(() => provider.refresh());
  specs.onDidDelete(() => provider.refresh());
  return [view, refresh, watcher, specs];
}
