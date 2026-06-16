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
import { randomBytes } from 'node:crypto';

type Status = 'pass' | 'fail' | 'flaky';

interface SpecRow {
  name: string;
  /** Absolute fsPath, or null for a spec seen only in run history (file gone). */
  path: string | null;
  /** Folder group under `__vibe_tests__/` ('' = top level). */
  group: string;
  security: boolean;
  cells: (Status | null)[];
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
function parsePlaywrightRun(json: unknown): Record<string, Status> {
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
      return {
        name,
        path: uri ? uri.fsPath : null,
        group: uri ? specGroup(uri.fsPath) : '',
        security: name.endsWith('.security.spec.ts'),
        cells: runs.map((r) => r.specs[name] ?? null) as (Status | null)[],
      };
    });

  // Flaky = a spec that both passed and failed across the window.
  const flaky = rows.filter((r) => {
    const seen = new Set(r.cells.filter(Boolean));
    return seen.has('flaky') || (seen.has('pass') && seen.has('fail'));
  }).length;

  // Pass rate of the latest run.
  let passRate: number | null = null;
  const last = runs[runs.length - 1];
  if (last) {
    const vals = Object.values(last.specs);
    if (vals.length) passRate = Math.round((vals.filter((s) => s === 'pass').length / vals.length) * 100);
  }

  // Sessions → 7-day token spend.
  const sessUris = (await vscode.workspace.findFiles('**/.hover/sessions/*.json', '**/node_modules/**'))
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

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string; path?: string }) => {
      if (msg.type === 'ready' || msg.type === 'refresh') void this.push();
      else if (msg.type === 'runAll') void vscode.commands.executeCommand('hover.runAllSpecs');
      else if (msg.type === 'runSpec' && msg.path) void vscode.commands.executeCommand('hover.runSpec', vscode.Uri.file(msg.path));
      else if (msg.type === 'optimize' && msg.path) void vscode.commands.executeCommand('hover.optimizeSpec', vscode.Uri.file(msg.path));
      else if (msg.type === 'open' && msg.path) void vscode.window.showTextDocument(vscode.Uri.file(msg.path));
    });
  }

  refresh(): void {
    void this.push();
  }

  private async push(): Promise<void> {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'data', data: await gather() });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root {
    --bg:#1a1a1a; --bg-2:#222224; --bg-3:#141414; --line:#2a2a2c;
    --text:#e5e7eb; --mute:#9ca3af; --dim:#6b7280;
    --pass:#7CFFA8; --fail:#f87171; --flaky:#fb923c; --accent:#7CFFA8;
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:10px; font-family: var(--vscode-font-family); font-size:12px; color:var(--text); background:var(--bg); }
  .runall { width:100%; padding:8px; margin-bottom:8px; border:none; border-radius:8px; background:var(--accent); color:#0c2417; font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
  .runall:hover { filter:brightness(1.08); }
  .search { position:relative; margin-bottom:10px; }
  .search input { width:100%; padding:7px 9px 7px 28px; border:1px solid var(--line); border-radius:8px; background:var(--bg-3); color:var(--text); font:inherit; font-size:12px; }
  .search input::placeholder { color:var(--dim); }
  .search input:focus { outline:none; border-color:#3a3a3d; }
  .search svg { position:absolute; left:9px; top:50%; transform:translateY(-50%); color:var(--dim); }
  .tiles { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:12px; }
  .tile { background:var(--bg-2); border:1px solid var(--line); border-radius:9px; padding:7px 9px; }
  .tile .n { font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; }
  .tile .k { color:var(--dim); font-size:10px; margin-top:1px; }
  .tile .n.ok { color:var(--pass); } .tile .n.bad { color:var(--fail); } .tile .n.warn { color:var(--flaky); }
  h3 { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:12px 2px 6px; font-weight:600; }
  .group { color:var(--mute); font-size:10.5px; margin:9px 4px 3px; display:flex; align-items:center; gap:5px; }
  .group svg { opacity:.7; }
  .row { display:flex; align-items:center; gap:7px; padding:5px 7px; border-radius:7px; min-height:30px; }
  .row:hover { background:var(--bg-2); }
  .row .ic { flex:none; color:var(--mute); display:inline-flex; }
  .row .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
  .row .nm:hover { color:var(--text); text-decoration:underline; }
  .row .cells { flex:none; display:flex; gap:2px; }
  .sq { width:11px; height:11px; border-radius:2px; flex:none; background:var(--line); }
  .sq.pass { background:var(--pass); } .sq.fail { background:var(--fail); } .sq.flaky { background:var(--flaky); }
  .row .acts { flex:none; display:none; gap:1px; }
  .row:hover .acts { display:flex; }
  .iact { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border:none; background:none; color:var(--mute); cursor:pointer; border-radius:5px; }
  .iact:hover { color:var(--text); background:var(--line); }
  .iact svg { width:14px; height:14px; }
  .legend { display:flex; gap:11px; color:var(--dim); font-size:10px; margin-top:10px; flex-wrap:wrap; }
  .legend span { display:inline-flex; align-items:center; gap:4px; }
  .legend i { width:9px; height:9px; border-radius:2px; display:inline-block; }
  .empty { color:var(--dim); text-align:center; padding:18px 6px; line-height:1.5; }
</style>
</head><body>
  <button class="runall" id="runall"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z"/></svg> Run all specs</button>
  <div class="search">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5" stroke-linecap="round"/></svg>
    <input id="q" type="text" placeholder="Search specs…" />
  </div>
  <div id="root"><div class="empty">Loading…</div></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var data = null, q = '';
  var SHIELD = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2l5 2v3.5c0 3-2.1 5.3-5 6.3C5.1 12.8 3 10.5 3 7.5V4l5-2z"/></svg>';
  var BEAKER = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 2v4L3 12.5a1 1 0 0 0 .9 1.5h8.2a1 1 0 0 0 .9-1.5L10 6V2M5 2h6"/></svg>';
  var PLAY = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 3l9 5-9 5z"/></svg>';
  var SPARKLE = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z"/></svg>';
  var FOLDER = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4.5h4l1.2 1.5H14v6.5H2z"/></svg>';
  function esc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtTok(n){ n=n||0; if(n<1000) return n+''; if(n<1e6) return (n/1000).toFixed(n<1e4?1:0)+'k'; return (n/1e6).toFixed(1)+'M'; }
  function attr(s){ return esc(s).replace(/"/g,'&quot;'); }
  function tile(n, k, cls){ return '<div class="tile"><div class="n '+(cls||'')+'">'+esc(n)+'</div><div class="k">'+esc(k)+'</div></div>'; }
  function rowHtml(r){
    var cells = r.cells.map(function(c){ return '<span class="sq '+(c||'')+'"></span>'; }).join('');
    var acts = r.path
      ? '<span class="acts"><button class="iact" data-act="run" data-p="'+attr(r.path)+'" title="Run">'+PLAY+'</button>'
        + '<button class="iact" data-act="opt" data-p="'+attr(r.path)+'" title="Optimize">'+SPARKLE+'</button></span>'
      : '';
    var name = r.path
      ? '<span class="nm" data-act="open" data-p="'+attr(r.path)+'" title="'+attr(r.name)+'">'+esc(r.name)+'</span>'
      : '<span class="nm" style="cursor:default" title="not on disk">'+esc(r.name)+'</span>';
    return '<div class="row"><span class="ic">'+(r.security?SHIELD:BEAKER)+'</span>'+name
      + '<span class="cells">'+cells+'</span>'+acts+'</div>';
  }
  function render(){
    var root = document.getElementById('root');
    if (!data) return;
    var t = data.tiles;
    var rate = t.passRate==null ? '—' : t.passRate+'%';
    var rateCls = t.passRate==null?'':(t.passRate>=90?'ok':(t.passRate>=60?'warn':'bad'));
    var html = '<div class="tiles">'
      + tile(t.specs, 'specs')
      + tile(rate, 'last pass rate', rateCls)
      + tile(t.flaky, 'flaky', t.flaky?'warn':'')
      + tile(fmtTok(t.tokens7d), 'tokens · 7d')
      + '</div>';

    var ql = q.trim().toLowerCase();
    var rows = data.rows.filter(function(r){ return !ql || r.name.toLowerCase().indexOf(ql) !== -1; });
    if (!rows.length) {
      html += '<div class="empty">' + (data.rows.length ? 'No specs match.' : 'No specs yet.<br/>Drive your app with Hover to crystallize one.') + '</div>';
      root.innerHTML = html; return;
    }
    // Group by folder, '' (top level) first.
    var groups = {}, order = [];
    rows.forEach(function(r){ if (!(r.group in groups)) { groups[r.group]=[]; order.push(r.group); } groups[r.group].push(r); });
    order.sort(function(a,b){ return a===''?-1:(b===''?1:a.localeCompare(b)); });
    html += '<h3>Specs</h3>';
    order.forEach(function(g){
      if (g) html += '<div class="group">'+FOLDER+esc(g)+'</div>';
      html += groups[g].map(rowHtml).join('');
    });
    html += '<div class="legend">'
      + '<span><i style="background:var(--pass)"></i>pass</span>'
      + '<span><i style="background:var(--fail)"></i>fail</span>'
      + '<span><i style="background:var(--flaky)"></i>flaky</span>'
      + '<span><i style="background:var(--line)"></i>not run</span></div>';
    root.innerHTML = html;
  }
  document.getElementById('runall').addEventListener('click', function(){ vscode.postMessage({type:'runAll'}); });
  document.getElementById('q').addEventListener('input', function(e){ q = e.target.value; render(); });
  document.getElementById('root').addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    var act = el.getAttribute('data-act'), p = el.getAttribute('data-p'); if (!p) return;
    vscode.postMessage({ type: act==='run'?'runSpec':(act==='opt'?'optimize':'open'), path: p });
  });
  window.addEventListener('message', function(e){ var m=e.data; if(m && m.type==='data'){ data=m.data; render(); } });
  vscode.postMessage({type:'ready'});
</script>
</body></html>`;
  }
}

/** Register the Dashboard view + a refresh command + file watchers that keep it
 *  live as runs / sessions / specs change. Returns disposables. */
export function registerDashboardView(): vscode.Disposable[] {
  const provider = new DashboardViewProvider();
  const view = vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  const refresh = vscode.commands.registerCommand('hover.refreshDashboard', () => provider.refresh());
  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/{runs,sessions}/*.json');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  const specs = vscode.workspace.createFileSystemWatcher('**/__vibe_tests__/**/*.spec.ts');
  specs.onDidCreate(() => provider.refresh());
  specs.onDidDelete(() => provider.refresh());
  return [view, refresh, watcher, specs];
}
