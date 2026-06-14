/**
 * The Hover Settings panel — a webview view in the sidebar (mirrors the widget's
 * settings menu). Holds: speech narration (#1), browser mode silent/visible
 * (#8), model selection (#7), and the model API key. Reads/writes VSCode config
 * (`hover.*`); the API key goes to SecretStorage and is pushed to the engine
 * via set-api-key. Changes are applied live by the extension (model → set-model,
 * key → set-api-key, speech/browser → re-broadcast to the chat).
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export interface SettingsHandlers {
  /** apiKey is read from / written to SecretStorage by the extension. */
  getApiKey(): Promise<string>;
  /** Coding agents the user can pick + the current one. */
  getAgents(): { current: string; list: string[] };
  onChange(change: { agent?: string; speech?: boolean; browser?: string; model?: string; apiKey?: string }): void | Promise<void>;
}

export class SettingsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.settings';
  private view?: vscode.WebviewView;

  constructor(private readonly handlers: SettingsHandlers) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: { type: string; [k: string]: unknown }) => {
      if (msg.type === 'ready') void this.pushState();
      else if (msg.type === 'change') void this.handlers.onChange(msg as never);
    });
  }

  private async pushState(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('hover');
    const agents = this.handlers.getAgents();
    void this.view?.webview.postMessage({
      type: 'state',
      agent: agents.current,
      agents: agents.list,
      speech: cfg.get<boolean>('speech', false),
      browser: cfg.get<string>('browser', 'silent'),
      model: cfg.get<string>('model', 'sonnet'),
      apiKey: await this.handlers.getApiKey(),
    });
  }

  /** Re-push when config changes elsewhere so the panel stays in sync. */
  refresh(): void {
    void this.pushState();
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root { --bg:#1a1a1a; --bg-2:#222224; --bg-3:#141414; --line:#2a2a2c; --text:#e5e7eb; --mute:#9ca3af; --dim:#6b7280; --accent:#7CFFA8; }
  * { box-sizing: border-box; }
  body { margin:0; padding:12px; font-family: var(--vscode-font-family); font-size:13px; color:var(--text); background:var(--bg); }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .label { display:flex; flex-direction:column; gap:2px; }
  .label .sub { color:var(--dim); font-size:11px; }
  select, input { background:var(--bg-3); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:5px 8px; font:inherit; }
  input { width:100%; }
  .field { display:block; padding:10px 0; }
  .field > .label { margin-bottom:6px; }
  /* toggle */
  .switch { position:relative; width:38px; height:22px; flex:none; }
  .switch input { display:none; }
  .slider { position:absolute; inset:0; background:var(--line); border-radius:999px; cursor:pointer; transition:.15s; }
  .slider:before { content:''; position:absolute; width:16px; height:16px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.15s; }
  .switch input:checked + .slider { background:var(--accent); }
  .switch input:checked + .slider:before { transform:translateX(16px); }
  .cloud .label { opacity:.65; }
  .cloudbtn { flex:none; white-space:nowrap; display:inline-flex; align-items:center; gap:5px; background:var(--bg-3); color:var(--mute); border:1px solid var(--line); border-radius:6px; padding:6px 12px; font:inherit; font-size:12px; opacity:.6; cursor:not-allowed; }
</style>
</head><body>
  <div class="row">
    <div class="label">Agent<span class="sub">The coding agent that drives the browser</span></div>
    <select id="agent"></select>
  </div>
  <div class="row">
    <div class="label">Speech narration<span class="sub">Speak tool calls + the summary aloud</span></div>
    <label class="switch"><input type="checkbox" id="speech" /><span class="slider"></span></label>
  </div>
  <div class="row">
    <div class="label">Browser<span class="sub">Silent = headless (no window); Visible = shown Chrome</span></div>
    <select id="browser"><option value="silent">Silent</option><option value="visible">Visible</option></select>
  </div>
  <div class="row">
    <div class="label">Model<span class="sub">Sonnet is cheapest; Opus for hard flows</span></div>
    <select id="model"><option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option></select>
  </div>
  <div class="field">
    <div class="label">Model API key<span class="sub">Optional — drive on your own key. Stored locally (SecretStorage), never uploaded.</span></div>
    <input type="password" id="apiKey" placeholder="sk-…  (blank = use your logged-in CLI)" />
  </div>
  <div class="row cloud">
    <div class="label">Hover Cloud<span class="sub">Cross-machine sync, team-shared environments, run dashboards — coming soon.</span></div>
    <button class="cloudbtn" disabled title="Coming with Hover Cloud">☁ Sign in</button>
  </div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var agent=document.getElementById('agent'), speech=document.getElementById('speech'), browser=document.getElementById('browser'), model=document.getElementById('model'), apiKey=document.getElementById('apiKey');
  function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
  function change(patch){ vscode.postMessage(Object.assign({type:'change'}, patch)); }
  agent.addEventListener('change', function(){ change({agent: agent.value}); });
  speech.addEventListener('change', function(){ change({speech: speech.checked}); });
  browser.addEventListener('change', function(){ change({browser: browser.value}); });
  model.addEventListener('change', function(){ change({model: model.value}); });
  var keyTimer; apiKey.addEventListener('input', function(){ clearTimeout(keyTimer); keyTimer=setTimeout(function(){ change({apiKey: apiKey.value}); }, 600); });
  window.addEventListener('message', function(e){ var m=e.data; if(m && m.type==='state'){
    var list=m.agents||['claude']; agent.innerHTML=''; list.forEach(function(id){ var o=document.createElement('option'); o.value=id; o.textContent=cap(id); agent.appendChild(o); }); agent.value=m.agent||'claude';
    speech.checked=!!m.speech; browser.value=m.browser||'silent'; model.value=m.model||'sonnet'; if(document.activeElement!==apiKey) apiKey.value=m.apiKey||'';
  } });
  vscode.postMessage({type:'ready'});
</script>
</body></html>`;
  }
}

export function registerSettingsView(handlers: SettingsHandlers): { provider: SettingsViewProvider; disposable: vscode.Disposable } {
  const provider = new SettingsViewProvider(handlers);
  const disposable = vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposable };
}
