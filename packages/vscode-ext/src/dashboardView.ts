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
 * the separate view.
 *
 * The `DashboardData` shape + all pure computation live in
 * `@hover-dev/core/dashboard` — the v1 contract Hover Cloud's
 * `GET /api/v1/dashboard` also emits. This file only owns the IO: local
 * gathering (workspace fs), the cloud fetch when connected (merged into ONE
 * timeline — a CI run synced locally as `ci-<id>.json` and the same run
 * ingested by the cloud dedup to the cloud copy), and the webview plumbing.
 */
import * as vscode from 'vscode';
import { DEFAULT_CLOUD_URL, fetchDashboard, readCloudCredentials } from '@hover-dev/core/cloud';
import {
  MAX_RUNS,
  buildDashboard,
  dashboardRunSlices,
  mergeRunSlices,
  parsePlaywrightRun,
  type DashboardData,
  type RunSlice,
  type SpecFileRef,
} from '@hover-dev/core/dashboard';
import { originRepo } from './githubCi.js';
import { renderWebviewHtml } from './webviewHost.js';

async function readJson(uri: vscode.Uri): Promise<unknown | null> {
  try {
    return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8'));
  } catch {
    return null;
  }
}

async function localRunSlices(): Promise<RunSlice[]> {
  const runUris = (await vscode.workspace.findFiles('**/.hover/runs/*.json', '**/node_modules/**'))
    .sort((a, b) => a.path.localeCompare(b.path)) // filename is the ISO stamp → chronological
    .slice(-MAX_RUNS);
  const runs: RunSlice[] = [];
  for (const uri of runUris) {
    const json = await readJson(uri);
    if (!json) continue;
    const id = (uri.path.split('/').pop() ?? '').replace(/\.json$/, '');
    runs.push({ id, ts: id, specs: parsePlaywrightRun(json) });
  }
  return runs;
}

/** Agent runs (one meta.json per run, grouped by conversation) → 7-day token spend. */
async function localTokens7d(): Promise<number> {
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
  return tokens7d;
}

// The cloud fetch is best-effort decoration of the local dashboard: bounded so
// a slow network can't wedge a refresh, cached so file-watcher refresh bursts
// don't hammer the API, null (→ local-only) on any miss.
const CLOUD_TIMEOUT_MS = 8_000;
const CLOUD_TTL_MS = 60_000;
let cloudCache: { at: number; data: DashboardData | null } | undefined;

/** True when Hover Cloud credentials are present (the panel's poll trigger). */
export function cloudConnected(): boolean {
  return readCloudCredentials() !== null;
}

async function fetchCloudDashboard(): Promise<DashboardData | null> {
  if (cloudCache && Date.now() - cloudCache.at < CLOUD_TTL_MS) return cloudCache.data;
  const data = await (async () => {
    const creds = readCloudCredentials();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!creds || !folder) return null;
    const repo = await originRepo(folder.uri.fsPath);
    if (!repo) return null;
    try {
      return await fetchDashboard(creds, `${repo.owner}/${repo.repo}`, (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) }),
      );
    } catch {
      return null; // offline / no project for this repo / revoked token
    }
  })();
  cloudCache = { at: Date.now(), data };
  return data;
}

async function gather(): Promise<DashboardData> {
  const specUris = await vscode.workspace.findFiles('**/__vibe_tests__/**/*.spec.ts', '**/node_modules/**');
  // basename → its file (for actions / open). Multiple specs can't share a
  // basename across folders in practice; last one wins, which is fine for the
  // run-history lookup keyed by basename.
  const files = new Map<string, SpecFileRef>();
  for (const u of specUris) files.set(u.path.split('/').pop() ?? '', { path: u.fsPath });
  const catalogueCount = files.size;

  let runs = await localRunSlices();
  const cloud = await fetchCloudDashboard();
  if (cloud?.hasRuns) {
    runs = mergeRunSlices(runs, dashboardRunSlices(cloud));
    // Cloud-only specs (no local file — deleted, or authored on another
    // machine) still get a row, keyed to their repo-relative path.
    for (const row of cloud.rows) {
      if (!files.has(row.name)) files.set(row.name, { path: null, specFile: row.specFile });
    }
  }

  return buildDashboard(runs, files, await localTokens7d(), catalogueCount);
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
      else if (msg.type === 'connectCloud') void vscode.commands.executeCommand('hover.connectCloud');
      else if (msg.type === 'disconnectCloud') void vscode.commands.executeCommand('hover.disconnectCloud');
      else if (msg.type === 'openCloud') {
        const url = (readCloudCredentials()?.url ?? DEFAULT_CLOUD_URL).replace(/\/$/, '');
        void vscode.env.openExternal(vscode.Uri.parse(`${url}/dashboard`));
      }
    });
  }

  refresh(): void {
    void this.push();
  }

  private async push(): Promise<void> {
    if (!this.view) return;
    const creds = readCloudCredentials();
    const cloud = creds ? { connected: true as const, url: creds.url } : { connected: false as const };
    void this.view.webview.postMessage({ type: 'data', data: await gather(), cloud });
  }

}

/** Register the Dashboard view + a refresh command + file watchers that keep it
 *  live as runs / sessions / specs change. Returns disposables. */
export function registerDashboardView(extensionUri: vscode.Uri): vscode.Disposable[] {
  const provider = new DashboardViewProvider(extensionUri);
  const view = vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  const refresh = vscode.commands.registerCommand('hover.refreshDashboard', () => {
    cloudCache = undefined; // an explicit refresh skips the cloud TTL
    provider.refresh();
  });
  // Cloud runs land without touching local files — poll just past the cache TTL
  // when connected. Disconnected, the tick is a no-op re-read of local state.
  const cloudTick = setInterval(() => {
    if (cloudConnected()) provider.refresh();
  }, CLOUD_TTL_MS + 5_000);
  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/{runs/*.json,conversations/**}');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  const specs = vscode.workspace.createFileSystemWatcher('**/__vibe_tests__/**/*.spec.ts');
  specs.onDidCreate(() => provider.refresh());
  specs.onDidDelete(() => provider.refresh());
  return [view, refresh, watcher, specs, { dispose: () => clearInterval(cloudTick) }];
}
