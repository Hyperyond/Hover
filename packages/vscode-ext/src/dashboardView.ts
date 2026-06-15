/**
 * The Hover "Dashboard" — a local, sidebar webview that stitches the three
 * `.hover/` data sources into one health view (the local-first mirror of what
 * Hover Cloud will eventually aggregate across machines/team):
 *
 *   - `.hover/runs/*.json`  — Playwright spec-run results (json reporter), written
 *     by the ▶ Run commands. → the spec × recent-run pass/fail matrix + flakiness.
 *   - `.hover/sessions/*.json` — agent authoring runs (v2). → 7-day spend + the
 *     recent-findings list.
 *   - the spec catalogue (spec files under __vibe_tests__). → spec count + rows
 *     for specs that exist but haven't been run yet.
 *
 * Deliberately read-only over a plain data model (`DashboardData`) so the same
 * webview can later be fed by a Cloud API instead of the local filesystem —
 * local now, no rewrite for Cloud (see project-hover-cloud-direction).
 *
 * Webview (not a TreeView) because the matrix of coloured squares can't be drawn
 * with TreeItems. Compact by design — it lives in the narrow sidebar.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

type Status = 'pass' | 'fail' | 'flaky';

interface DashboardData {
  hasRuns: boolean;
  tiles: { specs: number; passRate: number | null; flaky: number; tokens7d: number; findings: number };
  runs: { id: string; ts: string }[];
  rows: { spec: string; cells: (Status | null)[]; heal: boolean }[];
  findings: { severity: string; text: string; prompt?: string }[];
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

async function gather(): Promise<DashboardData> {
  const specUris = await vscode.workspace.findFiles('**/__vibe_tests__/**/*.spec.ts', '**/node_modules/**');
  const catalogue = new Set(specUris.map((u) => u.path.split('/').pop() ?? '').filter(Boolean));

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
  const allSpecs = new Set<string>(catalogue);
  for (const r of runs) for (const k of Object.keys(r.specs)) allSpecs.add(k);
  const rows = [...allSpecs]
    .sort((a, b) => a.localeCompare(b))
    .map((spec) => {
      const cells = runs.map((r) => r.specs[spec] ?? null) as (Status | null)[];
      // Self-heal is offered when the spec's most recent run failed or flaked —
      // re-recording (the agent re-derives the flow) is the heal action.
      const latest = [...cells].reverse().find((c) => c != null) ?? null;
      return { spec, cells, heal: latest === 'fail' || latest === 'flaky' };
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

  // Sessions → 7-day spend + recent findings.
  const sessUris = (await vscode.workspace.findFiles('**/.hover/sessions/*.json', '**/node_modules/**'))
    .sort((a, b) => b.path.localeCompare(a.path))
    .slice(0, 40);
  const weekAgo = Date.now() - 7 * 864e5;
  let tokens7d = 0;
  const findings: { severity: string; text: string; prompt?: string }[] = [];
  for (const uri of sessUris) {
    const s = (await readJson(uri)) as
      | { tokensUsed?: number; startedAt?: string; findings?: { severity?: string; text?: string }[]; prompt?: string }
      | null;
    if (!s) continue;
    const started = s.startedAt ? Date.parse(s.startedAt) : NaN;
    if (typeof s.tokensUsed === 'number' && (Number.isNaN(started) || started >= weekAgo)) tokens7d += s.tokensUsed;
    for (const f of s.findings ?? []) {
      if (findings.length < 8) findings.push({ severity: f.severity ?? 'note', text: f.text ?? '', prompt: s.prompt });
    }
  }

  return {
    hasRuns: runs.length > 0,
    tiles: { specs: catalogue.size, passRate, flaky, tokens7d, findings: findings.length },
    runs: runs.map((r) => ({ id: r.id, ts: r.ts })),
    rows,
    findings,
  };
}

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.dashboard';
  private view?: vscode.WebviewView;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string; spec?: string }) => {
      if (msg.type === 'ready' || msg.type === 'refresh') void this.push();
      else if (msg.type === 'runAll') void vscode.commands.executeCommand('hover.runAllSpecs');
      else if (msg.type === 'openSpec' && msg.spec) void this.openSpec(msg.spec);
      else if (msg.type === 'selfHeal' && msg.spec) void this.selfHeal(msg.spec);
    });
  }

  /** Self-heal a failing spec: re-run the agent against its original prompt so
   *  it re-derives the flow, overwriting the spec. Reuses hover.reRecordSpec. */
  private async selfHeal(basename: string): Promise<void> {
    const hits = await vscode.workspace.findFiles(`**/__vibe_tests__/**/${basename}`, '**/node_modules/**', 1);
    if (hits[0]) void vscode.commands.executeCommand('hover.reRecordSpec', hits[0]);
  }

  refresh(): void {
    void this.push();
  }

  private async openSpec(basename: string): Promise<void> {
    const hits = await vscode.workspace.findFiles(`**/__vibe_tests__/**/${basename}`, '**/node_modules/**', 1);
    if (hits[0]) void vscode.window.showTextDocument(hits[0]);
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
    --pass:#7CFFA8; --fail:#f87171; --flaky:#fb923c;
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:12px; font-family: var(--vscode-font-family); font-size:12px; color:var(--text); background:var(--bg); }
  .tiles { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:14px; }
  .tile { background:var(--bg-2); border:1px solid var(--line); border-radius:9px; padding:8px 10px; }
  .tile .n { font-size:17px; font-weight:700; font-variant-numeric:tabular-nums; }
  .tile .k { color:var(--dim); font-size:10.5px; margin-top:1px; }
  .tile .n.ok { color:var(--pass); } .tile .n.bad { color:var(--fail); } .tile .n.warn { color:var(--flaky); }
  h3 { font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:14px 0 7px; font-weight:600; }
  .matrix { display:flex; flex-direction:column; gap:4px; overflow-x:auto; }
  .mrow { display:flex; align-items:center; gap:8px; }
  .mname { flex:none; width:108px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--mute); cursor:pointer; }
  .mname:hover { color:var(--text); text-decoration:underline; }
  .cells { display:flex; gap:3px; }
  .sq { width:13px; height:13px; border-radius:3px; flex:none; background:var(--line); }
  .sq.pass { background:var(--pass); } .sq.fail { background:var(--fail); } .sq.flaky { background:var(--flaky); }
  .heal { flex:none; margin-left:auto; padding:1px 5px; border:1px solid var(--line); background:var(--bg-3); line-height:1.3; }
  .heal:hover { border-color:var(--flaky); }
  .legend { display:flex; gap:12px; color:var(--dim); font-size:10.5px; margin-top:9px; }
  .legend span { display:inline-flex; align-items:center; gap:4px; }
  .legend i { width:9px; height:9px; border-radius:2px; display:inline-block; }
  .find { display:flex; gap:7px; align-items:flex-start; padding:5px 0; line-height:1.4; border-bottom:1px solid var(--line); }
  .find:last-child { border-bottom:none; }
  .badge { font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; flex:none; text-transform:uppercase; }
  .badge.bug { background:var(--fail); color:#240808; } .badge.minor { background:var(--flaky); color:#241805; } .badge.info { background:var(--line); color:var(--text); }
  .empty { color:var(--dim); text-align:center; padding:18px 6px; line-height:1.5; }
  button { font:inherit; font-size:12px; cursor:pointer; border-radius:7px; }
  .runall { width:100%; margin-top:14px; padding:7px; border:none; background:var(--pass); color:#0c2417; font-weight:600; display:inline-flex; align-items:center; justify-content:center; gap:6px; }
  .runall:hover { filter:brightness(1.08); }
  .muted { color:var(--dim); font-size:10.5px; }
</style>
</head><body>
  <div id="root"><div class="empty">Loading…</div></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  function esc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function sev(s){ s=(s||'').toLowerCase(); return (s==='bug'||s==='major'||s==='high'||s==='critical')?'bug':(s==='info'||s==='note'?'info':'minor'); }
  function fmtTok(n){ n=n||0; if(n<1000) return n+''; if(n<1e6) return (n/1000).toFixed(n<1e4?1:0)+'k'; return (n/1e6).toFixed(1)+'M'; }
  function tile(n, k, cls){ return '<div class="tile"><div class="n '+(cls||'')+'">'+esc(n)+'</div><div class="k">'+esc(k)+'</div></div>'; }
  function render(d){
    var root = document.getElementById('root');
    var t = d.tiles;
    var rate = t.passRate==null ? '—' : t.passRate+'%';
    var rateCls = t.passRate==null?'':(t.passRate>=90?'ok':(t.passRate>=60?'warn':'bad'));
    var html = '<div class="tiles">'
      + tile(t.specs, 'specs')
      + tile(rate, 'last pass rate', rateCls)
      + tile(t.flaky, 'flaky', t.flaky?'warn':'')
      + tile(fmtTok(t.tokens7d), 'tokens · 7d')
      + '</div>';

    if (!d.hasRuns) {
      html += '<div class="empty">No test runs yet.<br/>Run your specs to populate the dashboard.</div>'
        + '<button class="runall" id="runall">▶ Run all specs</button>';
      root.innerHTML = html; wire(); return;
    }

    html += '<h3>Spec × recent runs</h3><div class="matrix">';
    d.rows.forEach(function(r){
      var cells = r.cells.map(function(c){ return '<span class="sq '+(c||'')+'"></span>'; }).join('');
      var heal = r.heal ? '<button class="heal" data-spec="'+esc(r.spec)+'" title="Self-heal — re-record this spec against its original prompt">🔧</button>' : '';
      html += '<div class="mrow"><span class="mname" data-spec="'+esc(r.spec)+'" title="'+esc(r.spec)+'">'+esc(r.spec)+'</span><span class="cells">'+cells+'</span>'+heal+'</div>';
    });
    html += '</div><div class="legend">'
      + '<span><i style="background:var(--pass)"></i>pass</span>'
      + '<span><i style="background:var(--fail)"></i>fail</span>'
      + '<span><i style="background:var(--flaky)"></i>flaky</span>'
      + '<span><i style="background:var(--line)"></i>not run</span></div>';

    if (d.findings.length) {
      html += '<h3>Recent findings</h3>';
      d.findings.forEach(function(f){
        html += '<div class="find"><span class="badge '+sev(f.severity)+'">'+esc(f.severity)+'</span><span>'+esc(f.text)+'</span></div>';
      });
    }
    html += '<button class="runall" id="runall">▶ Run all specs</button>';
    root.innerHTML = html; wire();
  }
  function wire(){
    var b = document.getElementById('runall');
    if (b) b.addEventListener('click', function(){ vscode.postMessage({type:'runAll'}); });
    Array.prototype.forEach.call(document.querySelectorAll('.mname'), function(el){
      el.addEventListener('click', function(){ vscode.postMessage({type:'openSpec', spec: el.getAttribute('data-spec')}); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.heal'), function(el){
      el.addEventListener('click', function(){ vscode.postMessage({type:'selfHeal', spec: el.getAttribute('data-spec')}); });
    });
  }
  window.addEventListener('message', function(e){ var m=e.data; if(m && m.type==='data') render(m.data); });
  vscode.postMessage({type:'ready'});
</script>
</body></html>`;
  }
}

/** Register the Dashboard view + a refresh command + file watchers that keep
 *  it live as runs / sessions / specs change. Returns disposables. */
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
