/**
 * The Hover "Conversations" view — a sidebar webview listing the multi-session
 * chats (the same conversations the chat top-bar switcher shows), modelled on
 * Claude Code's session sidebar: a Local / Cloud (locked) tab pair, a search
 * box, and one row per conversation showing its name, a "last run N ago" stamp,
 * and a running dot. Hovering a row reveals inline rename / delete.
 *
 * The extension owns the conversation store (ChatSession in workspaceState), so
 * this is a thin presenter: the extension pushes the list via setConversations()
 * and the webview posts back switch / new / rename / delete intents. Rename is
 * edited inline (the row name becomes an input); delete confirms natively. Cloud
 * is a disabled placeholder until Hover Cloud (cross-machine / team sessions).
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
  onRename: (id: string, name: string) => void;
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
    view.webview.onDidReceiveMessage((msg: { type: string; id?: string; name?: string }) => {
      if (msg.type === 'ready') { this.push(); return; }
      if (msg.type === 'new') { this.handlers.onNew(); return; }
      if (!msg.id) return;
      if (msg.type === 'switch') this.handlers.onSwitch(msg.id);
      else if (msg.type === 'rename' && typeof msg.name === 'string') this.handlers.onRename(msg.id, msg.name);
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
  :root { --bg:#1a1a1a; --bg-2:#242426; --bg-3:#0f0f0f; --line:#2c2c2e; --text:#e8eaed; --mute:#a8adb7; --dim:#6b7079; --accent:#7CFFA8; --run:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; padding:10px 10px 12px; font-family: var(--vscode-font-family); font-size:12.5px; color:var(--text); background:var(--bg); }
  .newbtn { width:100%; display:flex; align-items:center; gap:8px; padding:8px 10px; margin-bottom:10px; border:1px solid var(--line); border-radius:9px; background:var(--bg-2); color:var(--text); cursor:pointer; font:inherit; font-size:12.5px; font-weight:500; }
  .newbtn:hover { background:#2c2c2f; border-color:#3a3a3d; }
  .newbtn svg { flex:none; opacity:.85; }

  .tabs { display:flex; gap:2px; margin-bottom:10px; background:var(--bg-3); border:1px solid var(--line); border-radius:9px; padding:3px; }
  .tab { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:5px; padding:6px 4px; border-radius:6px; color:var(--dim); cursor:pointer; user-select:none; font-weight:500; transition:background .12s,color .12s; }
  .tab.active { color:var(--text); background:var(--bg-2); }
  .tab.locked { cursor:default; }
  .tab.locked:hover { color:var(--dim); }
  .tab svg { flex:none; opacity:.8; }

  .search { position:relative; margin-bottom:8px; }
  .search svg { position:absolute; left:9px; top:50%; transform:translateY(-50%); color:var(--dim); pointer-events:none; }
  .search input { width:100%; padding:7px 9px 7px 28px; border:1px solid var(--line); border-radius:8px; background:var(--bg-3); color:var(--text); font:inherit; font-size:12.5px; }
  .search input::placeholder { color:var(--dim); }
  .search input:focus { outline:none; border-color:#3a3a3d; }

  .list { display:flex; flex-direction:column; gap:1px; }
  /* Fixed height (not min-height) so hovering — which swaps the "N ago" stamp
     for the taller action buttons — never grows the row. */
  .row { display:flex; align-items:center; gap:8px; padding:0 9px; border-radius:8px; cursor:pointer; height:36px; }
  .row:hover { background:var(--bg-2); }
  .row.active { background:var(--bg-2); }
  .row .dot { flex:none; width:6px; height:6px; border-radius:50%; background:var(--run); visibility:hidden; }
  .row.running .dot { visibility:visible; animation:pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.25; } }
  .row .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--mute); }
  .row:hover .nm, .row.active .nm { color:var(--text); }
  .row.active .nm { font-weight:600; }
  .row .nm-edit { flex:1; min-width:0; padding:3px 6px; border:1px solid var(--accent); border-radius:6px; background:var(--bg-3); color:var(--text); font:inherit; font-size:12.5px; }
  .row .nm-edit:focus { outline:none; }
  /* "last run N ago" is ALWAYS visible; hover just reveals the actions to its
     right (it is not swapped out). */
  .row .ago { flex:none; color:var(--dim); font-size:11.5px; font-variant-numeric:tabular-nums; }
  .row .acts { flex:none; display:none; gap:1px; margin-left:2px; }
  .row:hover .acts { display:flex; }
  .iact { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border:none; background:none; color:var(--mute); cursor:pointer; border-radius:6px; }
  .iact:hover { color:var(--text); background:#343438; }
  .iact svg { width:15px; height:15px; }

  .empty, .cloud { color:var(--dim); text-align:center; padding:26px 10px; line-height:1.55; }
  .cloud .lk { display:block; margin:0 auto 8px; opacity:.5; }
</style>
</head><body>
  <button class="newbtn" id="new">
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3.3v9.4M3.3 8h9.4"/></svg>
    <span>New session</span>
  </button>
  <div class="tabs">
    <div class="tab active" id="tab-local" data-tab="local">Local</div>
    <div class="tab locked" id="tab-cloud" data-tab="cloud" title="Cloud conversations — coming soon">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>
      <span>Cloud</span>
    </div>
  </div>
  <div class="search" id="search-wrap">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5" stroke-linecap="round"/></svg>
    <input id="search" type="text" placeholder="Search sessions…" />
  </div>
  <div class="list" id="list"></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var rows = [], activeId = '', tab = 'local', q = '', editing = null;
  var EDIT_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5 13.5 5 6 12.5l-3 .5.5-3z"/></svg>';
  var DEL_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/></svg>';
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
    document.getElementById('search-wrap').style.display = tab === 'local' ? '' : 'none';
    if (tab === 'cloud') {
      list.innerHTML = '<div class="cloud"><svg class="lk" width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>Cloud sessions are coming soon.<br/>Run, monitor &amp; share conversations across machines once Hover Cloud unlocks.</div>';
      return;
    }
    var ql = q.trim().toLowerCase();
    var shown = rows.filter(function(r){ return !ql || (r.name||'').toLowerCase().indexOf(ql) !== -1; });
    if (!shown.length) {
      list.innerHTML = '<div class="empty">' + (rows.length ? 'No conversations match.' : 'No conversations yet.<br/>Start one with New session.') + '</div>';
      return;
    }
    list.innerHTML = shown.map(function(r){
      var edit = editing === r.id;
      return '<div class="row' + (r.id===activeId?' active':'') + (r.running?' running':'') + '" data-id="'+esc(r.id)+'">'
        + '<span class="dot"></span>'
        + (edit
            ? '<input class="nm-edit" value="'+esc(r.name)+'" />'
            : '<span class="nm" title="'+esc(r.name)+'">'+esc(r.name)+'</span>'
              + '<span class="ago">'+esc(fmtAgo(r.lastRunAt))+'</span>'
              + '<span class="acts">'
              + '<button class="iact" data-act="rename" title="Rename">'+EDIT_SVG+'</button>'
              + '<button class="iact" data-act="delete" title="Delete">'+DEL_SVG+'</button>'
              + '</span>')
        + '</div>';
    }).join('');
    if (editing) {
      var inp = list.querySelector('.nm-edit');
      if (inp) { inp.focus(); inp.select(); }
    }
  }
  function commitEdit(id, value){
    editing = null;
    var v = (value||'').trim();
    var cur = rows.find(function(r){ return r.id===id; });
    if (v && cur && v !== cur.name) { cur.name = v; vscode.postMessage({ type:'rename', id:id, name:v }); }
    render();
  }
  document.getElementById('new').addEventListener('click', function(){ vscode.postMessage({ type:'new' }); });
  document.getElementById('tab-local').addEventListener('click', function(){ tab='local'; setTabs(); render(); });
  document.getElementById('tab-cloud').addEventListener('click', function(){ tab='cloud'; setTabs(); render(); });
  document.getElementById('search').addEventListener('input', function(e){ q = e.target.value; render(); });
  function setTabs(){
    document.getElementById('tab-local').classList.toggle('active', tab==='local');
    document.getElementById('tab-cloud').classList.toggle('active', tab==='cloud');
  }
  var list = document.getElementById('list');
  list.addEventListener('click', function(e){
    var t = e.target;
    var act = t && t.closest ? t.closest('.iact') : null;
    var row = t && t.closest ? t.closest('.row') : null;
    if (!row) return;
    var id = row.getAttribute('data-id');
    if (act) {
      e.stopPropagation();
      var a = act.getAttribute('data-act');
      if (a === 'rename') { editing = id; render(); }
      else if (a === 'delete') vscode.postMessage({ type:'delete', id:id });
      return;
    }
    if (id !== activeId) vscode.postMessage({ type:'switch', id:id });
  });
  list.addEventListener('keydown', function(e){
    if (!editing) return;
    var inp = e.target.closest ? e.target.closest('.nm-edit') : null;
    if (!inp) return;
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(editing, inp.value); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); }
  });
  list.addEventListener('focusout', function(e){
    var inp = e.target.closest ? e.target.closest('.nm-edit') : null;
    if (inp && editing) commitEdit(editing, inp.value);
  });
  window.addEventListener('message', function(e){
    var m = e.data; if (!m || m.type !== 'data') return;
    rows = Array.isArray(m.rows) ? m.rows : []; activeId = m.activeId || '';
    if (editing && !rows.some(function(r){ return r.id===editing; })) editing = null;
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
