/**
 * The "Business Map" cockpit view — a graph of the app's business lines + test
 * coverage, rendered from the `.hover/hover-map.md` wiki the Hover MCP maintains.
 * Read-only over the map: the agent authors/updates it; the cockpit visualizes
 * it and lets you act on each flow (open its route, run its spec, or hand an
 * uncovered flow to your coding agent).
 *
 * Two surfaces share ONE wiring (`wireBusinessMap`): a narrow sidebar
 * WebviewView (the `hover.businessMap` view) AND a full editor-area panel
 * (`hover.openBusinessMap`). Both speak the same `{type:'data', graph}` protocol
 * and the same inbound handlers (ready/refresh/open/openRoute/runSpec/handoff).
 *
 * Data source: `<workspace>/.hover/hover-map.md` → parseBusinessMap → graph;
 * spec basenames are resolved to absolute paths (so clicking a spec opens it and
 * "Run spec" works), and `.hover/runs/*.json` is folded in for live run colors.
 */
import * as vscode from 'vscode';
import { renderWebviewHtml } from './webviewHost.js';
import { parseBusinessMap, type BusinessMapGraph, type RunStatus } from './businessMap.js';
import { parsePlaywrightRun, type Status } from './dashboardView.js';
import { resolveTargetUrl } from './extension.js';

async function findMap(): Promise<vscode.Uri | null> {
  const hits = await vscode.workspace.findFiles('**/.hover/hover-map.md', '**/node_modules/**', 1);
  return hits[0] ?? null;
}

/** Worst-wins ranking so a line takes the worst of its specs' run outcomes. */
const RUN_RANK: Record<RunStatus, number> = { pass: 0, flaky: 1, fail: 2 };
function worseRun(a: RunStatus | undefined, b: RunStatus | undefined): RunStatus | undefined {
  if (!a) return b;
  if (!b) return a;
  return RUN_RANK[b] > RUN_RANK[a] ? b : a;
}

/** Latest run status per spec basename, merged across `.hover/runs/*.json`
 *  (later runs win — same chronological-by-filename convention the dashboard
 *  uses). Reuses dashboardView's `parsePlaywrightRun`. */
async function gatherRunStatus(): Promise<Record<string, Status>> {
  const runUris = (await vscode.workspace.findFiles('**/.hover/runs/*.json', '**/node_modules/**')).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const out: Record<string, Status> = {};
  for (const uri of runUris) {
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8'));
    } catch {
      continue;
    }
    Object.assign(out, parsePlaywrightRun(json));
  }
  return out;
}

/** Read + parse the map, resolving each spec basename to an absolute path,
 *  copying that path onto the owning line node, and folding in run colors. */
async function gather(): Promise<BusinessMapGraph | null> {
  const uri = await findMap();
  if (!uri) return null;
  let md: string;
  try {
    md = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
  } catch {
    return null;
  }
  const graph = parseBusinessMap(md);
  const runStatus = await gatherRunStatus();

  // Resolve spec filenames → absolute paths, attach run status, and propagate
  // path + (worst) run status up to the owning line node so the line's toolbar
  // can "Run spec" and the line colors by run.
  const lineBySpecId = new Map<string, string>(); // specId → lineId (from edges)
  for (const e of graph.edges) {
    if (e.target.startsWith('spec:')) lineBySpecId.set(e.target, e.source);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

  for (const node of graph.nodes) {
    if (node.kind !== 'spec' || !node.spec) continue;
    const found = await vscode.workspace.findFiles(`**/__vibe_tests__/**/${node.spec}`, '**/node_modules/**', 1);
    if (found[0]) node.path = found[0].fsPath;
    const run = runStatus[node.spec];
    if (run) node.run = run;
    // Copy onto the owning line node.
    const lineId = lineBySpecId.get(node.id);
    const line = lineId ? byId.get(lineId) : undefined;
    if (line) {
      if (!line.path && node.path) line.path = node.path;
      line.run = worseRun(line.run, run);
    }
  }
  return graph;
}

/** Inbound message shape (sidebar + panel both send these). */
interface InMsg {
  type: string;
  path?: string;
  route?: string;
  line?: string;
}

/** Wire one webview (sidebar OR panel) to the Business Map: push data on
 *  ready/refresh, and handle node interactions. Returns a `refresh()` that
 *  re-gathers + pushes, so the shared file watcher can keep both live. */
function wireBusinessMap(webview: vscode.Webview): { refresh: () => void; dispose: vscode.Disposable } {
  const push = async (): Promise<void> => {
    void webview.postMessage({ type: 'data', graph: await gather() });
  };
  const sub = webview.onDidReceiveMessage((msg: InMsg) => {
    if (msg.type === 'ready' || msg.type === 'refresh') void push();
    else if (msg.type === 'open' && msg.path) void vscode.window.showTextDocument(vscode.Uri.file(msg.path));
    else if (msg.type === 'openRoute' && msg.route) void openRoute(msg.route);
    else if (msg.type === 'runSpec' && msg.path)
      void vscode.commands.executeCommand('hover.runSpec', vscode.Uri.file(msg.path));
    else if (msg.type === 'handoff' && msg.line) void handoff(msg.line);
  });
  return { refresh: () => void push(), dispose: sub };
}

/** Open a business line's route in the user's browser, resolved against the
 *  active environment / dev-server base URL (same one the runner uses). */
async function openRoute(route: string): Promise<void> {
  const base = await resolveTargetUrl();
  if (!base) {
    void vscode.window.showInformationMessage(
      `Hover: no app URL resolved — start your dev server or set an environment. Route: ${route}`,
    );
    return;
  }
  const url = base.replace(/\/$/, '') + (route.startsWith('/') ? route : `/${route}`);
  void vscode.env.openExternal(vscode.Uri.parse(url));
}

/** Hand an uncovered flow to the user's coding agent: copy the Hover MCP
 *  command so they can paste it into Claude Code / Codex / etc. */
async function handoff(line: string): Promise<void> {
  await vscode.env.clipboard.writeText(`/mcp__hover__test_app scope:${line}`);
  void vscode.window.showInformationMessage(
    'Copied — paste it into your coding agent (e.g. Claude Code) to cover this flow.',
  );
}

export class BusinessMapViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.businessMap';
  private wired?: { refresh: () => void; dispose: vscode.Disposable };

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'business-map');
    this.wired = wireBusinessMap(view.webview);
    view.onDidDispose(() => {
      this.wired?.dispose.dispose();
      this.wired = undefined;
    });
  }

  refresh(): void {
    this.wired?.refresh();
  }
}

/** Open (or reveal) the full editor-area Business Map panel. One panel at a
 *  time; reuses the same wiring as the sidebar. */
function openBusinessMapPanel(extensionUri: vscode.Uri, track: (p: BusinessMapPanel) => void): void {
  const panel = vscode.window.createWebviewPanel(
    'hover.businessMap.panel',
    'Business Map',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    },
  );
  panel.webview.html = renderWebviewHtml(panel.webview, extensionUri, 'business-map');
  const wired = wireBusinessMap(panel.webview);
  const entry: BusinessMapPanel = { panel, refresh: wired.refresh };
  panel.onDidDispose(() => wired.dispose.dispose());
  track(entry);
}

interface BusinessMapPanel {
  panel: vscode.WebviewPanel;
  refresh: () => void;
}

/** Register the Business Map view + panel command + a single file watcher that
 *  keeps BOTH surfaces live as the map / specs / runs change. */
export function registerBusinessMapView(extensionUri: vscode.Uri): vscode.Disposable[] {
  const provider = new BusinessMapViewProvider(extensionUri);
  const view = vscode.window.registerWebviewViewProvider(BusinessMapViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });

  // Track open panels so the watcher refreshes them too (and drop them on dispose).
  let panels: BusinessMapPanel[] = [];
  const track = (p: BusinessMapPanel): void => {
    panels.push(p);
    p.panel.onDidDispose(() => {
      panels = panels.filter((x) => x !== p);
    });
  };
  const refreshAll = (): void => {
    provider.refresh();
    for (const p of panels) p.refresh();
  };

  const open = vscode.commands.registerCommand('hover.openBusinessMap', () =>
    openBusinessMapPanel(extensionUri, track),
  );
  const refresh = vscode.commands.registerCommand('hover.refreshBusinessMap', refreshAll);

  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/{hover-map.md,runs/*.json}');
  watcher.onDidCreate(refreshAll);
  watcher.onDidChange(refreshAll);
  watcher.onDidDelete(refreshAll);
  const specs = vscode.workspace.createFileSystemWatcher('**/__vibe_tests__/**/*.spec.ts');
  specs.onDidCreate(refreshAll);
  specs.onDidDelete(refreshAll);
  return [view, open, refresh, watcher, specs];
}
