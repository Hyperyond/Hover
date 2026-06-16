/**
 * The Hover "Conversations" view — a sidebar webview listing the multi-session
 * chats (the same conversations the chat top-bar switcher shows), modelled on
 * Claude Code's session sidebar: a Local / Web (cloud, locked) tab pair, a
 * search box, and one row per conversation showing its name, a "last run N ago"
 * stamp, and a running dot. Hovering a row reveals rename / delete.
 *
 * The extension owns the conversation store (ChatSession in workspaceState), so
 * this is a thin presenter: the extension pushes the list via setConversations()
 * and the webview posts back switch / new / rename / delete intents, which the
 * extension fulfils (rename/delete via native prompts). Web is a disabled
 * placeholder until Hover Cloud (cross-machine / team-shared conversations).
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export interface ConversationRow {
  id: string;
  name: string;
  /** Epoch ms of this conversation's most recent run (undefined = never run). */
  lastRunAt?: number;
  running?: boolean;
}

export interface ConversationHandlers {
  onSwitch: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}

export class ConversationsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.sessions';
  private view?: vscode.WebviewView;
  private rows: ConversationRow[] = [];
  private activeId = '';

  constructor(private readonly handlers: ConversationHandlers) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string; id?: string }) => {
      if (msg.type === 'ready') { this.push(); return; }
      if (msg.type === 'new') { this.handlers.onNew(); return; }
      if (!msg.id) return;
      if (msg.type === 'switch') this.handlers.onSwitch(msg.id);
      else if (msg.type === 'rename') this.handlers.onRename(msg.id);
      else if (msg.type === 'delete') this.handlers.onDelete(msg.id);
    });
  }

  /** Push the current conversation list + active id to the view. */
  setConversations(rows: ConversationRow[], activeId: string): void {
    this.rows = rows;
    this.activeId = activeId;
    this.push();
  }

  private push(): void {
    void this.view?.webview.postMessage({ type: 'data', rows: this.rows, activeId: this.activeId });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { --bg:#1a1a1a; --bg-2:#222224; --line:#2a2a2c; --text:#e5e7eb; --mute:#9ca3af; --dim:#6b7280; --accent:#7CFFA8; --run:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; padding:8px; font-family: var(--vscode-font-family); font-size:12px; color:var(--text); background:var(--bg); }
  .newbtn { width:100%; display:flex; align-items:center; gap:6px; padding:6px 8px; margin-bottom:8px; border:1px solid var(--line); border-radius:7px; background:var(--bg-2); color:var(--text); cursor:pointer; font:inherit; font-size:12px; }
  .newbtn:hover { background:var(--line); }
  .tabs { display:flex; gap:0; margin-bottom:8px; border-bottom:1px solid var(--line); }
  .tab { flex:1; text-align:center; padding:6px 4px; color:var(--dim); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; user-select:none; }
  .tab.active { color:var(--text); border-bottom-color:var(--accent); }
  .tab.locked { cursor:default; }
  .tab .lk { font-size:10px; opacity:.7; }
  .search { width:100%; padding:5px 8px; margin-bottom:8px; border:1px solid var(--line); border-radius:7px; background:#141414; color:var(--text); font:inherit; font-size:12px; }
  .search::placeholder { color:var(--dim); }
  .row { display:flex; align-items:center; gap:7px; padding:6px 7px; border-radius:7px; cursor:pointer; }
  .row:hover { background:var(--bg-2); }
  .row.active { background:var(--bg-2); }
  .row .dot { flex:none; width:7px; color:var(--run); font-size:9px; visibility:hidden; }
  .row.running .dot { visibility:visible; animation:pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
  .row .nm { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row.active .nm { font-weight:600; }
  .row .ago { flex:none; color:var(--dim); font-variant-numeric:tabular-nums; }
  .row .acts { flex:none; display:none; gap:2px; }
  .row:hover .acts { display:flex; }
  .row:hover .ago { display:none; }
  .iact { border:none; background:none; color:var(--mute); cursor:pointer; padding:2px 3px; border-radius:4px; font-size:12px; line-height:1; }
  .iact:hover { color:var(--text); background:var(--line); }
  .empty, .cloud { color:var(--dim); text-align:center; padding:22px 8px; line-height:1.5; }
</style>
</head><body>
  <button class="newbtn" id="new"><span>＋</span><span>New session</span></button>
  <div class="tabs">
    <div class="tab active" id="tab-local" data-tab="local">Local</div>
    <div class="tab locked" id="tab-web" data-tab="web" title="Cloud conversations — coming soon">Web <span class="lk">🔒</span></div>
  </div>
  <input class="search" id="search" type="text" placeholder="Search sessions…" />
  <div id="list"></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var rows = [], activeId = '', tab = 'local', q = '';
  function esc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtAgo(ts){
    if (!ts) return '';
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s/60); if (m < 60) return m + 'm';
    var h = Math.floor(m/60); if (h < 24) return h + 'h';
    var d = Math.floor(h/24); if (d < 7) return d + 'd';
    return Math.floor(d/7) + 'w';
  }
  function render(){
    var list = document.getElementById('list');
    var search = document.getElementById('search');
    search.style.display = tab === 'local' ? '' : 'none';
    if (tab === 'web') {
      list.innerHTML = '<div class="cloud">☁️ Cloud sessions are coming soon.<br/>Run, monitor & share conversations across machines once Hover Cloud unlocks.</div>';
      return;
    }
    var ql = q.trim().toLowerCase();
    var shown = rows.filter(function(r){ return !ql || (r.name||'').toLowerCase().indexOf(ql) !== -1; });
    if (!shown.length) {
      list.innerHTML = '<div class="empty">' + (rows.length ? 'No conversations match.' : 'No conversations yet.<br/>Start one with New session.') + '</div>';
      return;
    }
    list.innerHTML = shown.map(function(r){
      return '<div class="row' + (r.id===activeId?' active':'') + (r.running?' running':'') + '" data-id="'+esc(r.id)+'">'
        + '<span class="dot">●</span>'
        + '<span class="nm" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'
        + '<span class="ago">'+esc(fmtAgo(r.lastRunAt))+'</span>'
        + '<span class="acts"><button class="iact" data-act="rename" title="Rename">✎</button>'
        + '<button class="iact" data-act="delete" title="Delete">🗑</button></span>'
        + '</div>';
    }).join('');
  }
  document.getElementById('new').addEventListener('click', function(){ vscode.postMessage({ type:'new' }); });
  document.getElementById('tab-local').addEventListener('click', function(){ tab='local'; setTabs(); render(); });
  document.getElementById('tab-web').addEventListener('click', function(){ tab='web'; setTabs(); render(); });
  document.getElementById('search').addEventListener('input', function(e){ q = e.target.value; render(); });
  function setTabs(){
    document.getElementById('tab-local').classList.toggle('active', tab==='local');
    document.getElementById('tab-web').classList.toggle('active', tab==='web');
  }
  document.getElementById('list').addEventListener('click', function(e){
    var t = e.target;
    var act = t && t.closest ? t.closest('.iact') : null;
    var row = t && t.closest ? t.closest('.row') : null;
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (act) { e.stopPropagation(); vscode.postMessage({ type: act.getAttribute('data-act'), id: id }); return; }
    if (id !== activeId) vscode.postMessage({ type:'switch', id: id });
  });
  window.addEventListener('message', function(e){
    var m = e.data; if (!m || m.type !== 'data') return;
    rows = Array.isArray(m.rows) ? m.rows : []; activeId = m.activeId || '';
    render();
  });
  vscode.postMessage({ type:'ready' });
</script>
</body></html>`;
  }
}

/** Register the Conversations webview. The extension wires the handlers +
 *  pushes the list; returns the provider (for setConversations) + disposables. */
export function registerConversationsView(
  handlers: ConversationHandlers,
): { provider: ConversationsViewProvider; disposables: vscode.Disposable[] } {
  const provider = new ConversationsViewProvider(handlers);
  const view = vscode.window.registerWebviewViewProvider(ConversationsViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposables: [view] };
}
