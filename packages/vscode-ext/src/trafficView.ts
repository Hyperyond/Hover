/**
 * The Hover "Network" view — captured HTTP flows, live, in security / pentest
 * mode only.
 *
 * The security runtime's MITM proxy already captures every browser-reachable
 * request as a Flow and broadcasts `security:flow:added` / `security:flow:updated`
 * (and `security:flows:cleared` on reset) over the service WS. This view is a
 * thin presenter: the extension forwards those flows in, and the webview renders
 * a live list (method · URL · status · duration), click to expand request /
 * response detail. Empty (and hidden via the `hover.modeActive` context key) in
 * normal mode, where no proxy runs.
 *
 * This is the visible surface; the durable value is turning a flow into a
 * crystallized `.security.spec.ts` regression — that "Crystallize" action lands
 * on these rows next.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

interface FlowReq { method?: string; url?: string; startedAt?: number; headers?: Record<string, string>; body?: string }
interface FlowRes { statusCode?: number; statusMessage?: string; completedAt?: number; headers?: Record<string, string>; body?: string }
export interface Flow { id: string; request?: FlowReq; response?: FlowRes; mutated?: boolean }

const MAX_FLOWS = 500;

export class TrafficViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.traffic';
  private view?: vscode.WebviewView;
  private flows: Flow[] = [];

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string }) => {
      if (msg.type === 'ready') this.pushAll();
    });
  }

  /** Add or update a flow (keyed by id), newest last; cap the buffer. */
  upsert(flow: Flow): void {
    if (!flow || !flow.id) return;
    const i = this.flows.findIndex((f) => f.id === flow.id);
    if (i >= 0) this.flows[i] = flow;
    else {
      this.flows.push(flow);
      if (this.flows.length > MAX_FLOWS) this.flows.shift();
    }
    void this.view?.webview.postMessage({ type: 'flow', flow });
  }

  clear(): void {
    this.flows = [];
    void this.view?.webview.postMessage({ type: 'clear' });
  }

  private pushAll(): void {
    void this.view?.webview.postMessage({ type: 'all', flows: this.flows });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { --bg:#1a1a1a; --bg-2:#222224; --bg-3:#141414; --line:#2a2a2c; --text:#e5e7eb; --mute:#9ca3af; --dim:#6b7280; --ok:#7CFFA8; --warn:#fb923c; --err:#f87171; }
  * { box-sizing: border-box; }
  body { margin:0; padding:8px 8px 12px; font-family: var(--vscode-font-family); font-size:12px; color:var(--text); background:var(--bg); }
  .bar { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .search { position:relative; flex:1; }
  .search input { width:100%; padding:6px 9px 6px 26px; border:1px solid var(--line); border-radius:7px; background:var(--bg-3); color:var(--text); font:inherit; font-size:12px; }
  .search input::placeholder { color:var(--dim); }
  .search input:focus { outline:none; border-color:#3a3a3d; }
  .search svg { position:absolute; left:8px; top:50%; transform:translateY(-50%); color:var(--dim); }
  .count { flex:none; color:var(--dim); font-size:11px; font-variant-numeric:tabular-nums; }
  .list { display:flex; flex-direction:column; }
  .row { display:flex; align-items:center; gap:7px; padding:5px 6px; border-radius:6px; cursor:pointer; border-left:2px solid transparent; }
  .row:hover { background:var(--bg-2); }
  .row.open { background:var(--bg-2); border-left-color:var(--mute); }
  .m { flex:none; width:46px; font-weight:600; font-size:10.5px; letter-spacing:.02em; }
  .m.GET{color:#7cc7ff}.m.POST{color:var(--ok)}.m.PUT,.m.PATCH{color:var(--warn)}.m.DELETE{color:var(--err)}
  .u { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; direction:rtl; text-align:left; }
  .s { flex:none; font-variant-numeric:tabular-nums; }
  .s.ok{color:var(--ok)}.s.warn{color:var(--warn)}.s.err{color:var(--err)}.s.pend{color:var(--dim)}
  .d { flex:none; color:var(--dim); font-size:10.5px; width:46px; text-align:right; }
  .detail { padding:7px 10px; margin:0 0 4px; background:var(--bg-3); border-radius:6px; font-family:var(--vscode-editor-font-family,monospace); font-size:11px; white-space:pre-wrap; word-break:break-all; color:var(--mute); }
  .detail b { color:var(--text); font-weight:600; }
  .empty { color:var(--dim); text-align:center; padding:26px 10px; line-height:1.5; }
</style>
</head><body>
  <div class="bar">
    <div class="search">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5" stroke-linecap="round"/></svg>
      <input id="q" type="text" placeholder="Filter by URL or method…" />
    </div>
    <span class="count" id="count"></span>
  </div>
  <div id="root"></div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var flows = [], q = '', openId = null;
  function esc(t){ return String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function statusClass(c){ if(c==null) return 'pend'; if(c<300) return 'ok'; if(c<400) return 'warn'; return 'err'; }
  function dur(f){ var r=f.request, s=f.response; if(r&&s&&r.startedAt&&s.completedAt){ var ms=s.completedAt-r.startedAt; return ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s'; } return ''; }
  function headersText(h){ if(!h) return ''; return Object.keys(h).map(function(k){ return k+': '+h[k]; }).join('\\n'); }
  function detailHtml(f){
    var r=f.request||{}, s=f.response||{};
    var out = '<b>'+esc((r.method||'').toUpperCase())+'</b> '+esc(r.url||'')+'\\n';
    if (s.statusCode!=null) out += '<b>← '+esc(s.statusCode)+(s.statusMessage?' '+esc(s.statusMessage):'')+'</b>\\n';
    var rh=headersText(r.headers); if(rh) out += '\\n<b>Request headers</b>\\n'+esc(rh)+'\\n';
    if(r.body) out += '\\n<b>Request body</b>\\n'+esc(String(r.body).slice(0,2000))+'\\n';
    var sh=headersText(s.headers); if(sh) out += '\\n<b>Response headers</b>\\n'+esc(sh)+'\\n';
    if(s.body) out += '\\n<b>Response body</b>\\n'+esc(String(s.body).slice(0,2000));
    return out;
  }
  function shortUrl(u){ try { var x=new URL(u); return x.pathname+x.search; } catch(e){ return u||''; } }
  function render(){
    var root=document.getElementById('root');
    var ql=q.trim().toLowerCase();
    var shown=flows.filter(function(f){ var r=f.request||{}; return !ql || ((r.url||'')+' '+(r.method||'')).toLowerCase().indexOf(ql)!==-1; });
    document.getElementById('count').textContent = shown.length ? shown.length+'' : '';
    if(!shown.length){ root.innerHTML='<div class="empty">'+(flows.length?'No requests match.':'No requests captured yet.<br/>Browse your app in security / pentest mode to capture traffic.')+'</div>'; return; }
    // Newest first.
    var html='<div class="list">';
    for(var i=shown.length-1;i>=0;i--){
      var f=shown[i], r=f.request||{}, s=f.response||{};
      var m=(r.method||'').toUpperCase();
      var code=s.statusCode;
      html += '<div class="row'+(f.id===openId?' open':'')+'" data-id="'+esc(f.id)+'">'
        + '<span class="m '+esc(m)+'">'+esc(m)+'</span>'
        + '<span class="u" title="'+esc(r.url||'')+'">'+esc(shortUrl(r.url))+'</span>'
        + '<span class="s '+statusClass(code)+'">'+esc(code==null?'…':code)+'</span>'
        + '<span class="d">'+esc(dur(f))+'</span></div>';
      if(f.id===openId) html += '<div class="detail">'+detailHtml(f)+'</div>';
    }
    html+='</div>';
    root.innerHTML=html;
  }
  document.getElementById('q').addEventListener('input', function(e){ q=e.target.value; render(); });
  document.getElementById('root').addEventListener('click', function(e){
    var row=e.target&&e.target.closest?e.target.closest('.row'):null; if(!row) return;
    var id=row.getAttribute('data-id'); openId = (openId===id)?null:id; render();
  });
  window.addEventListener('message', function(e){
    var m=e.data; if(!m) return;
    if(m.type==='all'){ flows=Array.isArray(m.flows)?m.flows:[]; render(); }
    else if(m.type==='flow'){ var i=flows.findIndex(function(f){return f.id===m.flow.id;}); if(i>=0) flows[i]=m.flow; else flows.push(m.flow); render(); }
    else if(m.type==='clear'){ flows=[]; openId=null; render(); }
  });
  vscode.postMessage({type:'ready'});
</script>
</body></html>`;
  }
}

/** Register the Network view. The extension forwards flows in via the returned
 *  provider; returns it + disposables. */
export function registerTrafficView(): { provider: TrafficViewProvider; disposables: vscode.Disposable[] } {
  const provider = new TrafficViewProvider();
  const view = vscode.window.registerWebviewViewProvider(TrafficViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposables: [view] };
}
