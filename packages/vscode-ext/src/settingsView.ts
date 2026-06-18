/**
 * The Hover Settings panel — a webview view in the sidebar.
 *
 * Model configuration is a two-tab switch (mirroring the reference design):
 *
 *   • Local CLI — pick a coding-agent CLI on your PATH (claude / codex /
 *     gemini / Local LLM). Auto-detected CLIs render as selectable cards;
 *     not-installed ones fold under "Installable" with a copy-paste install
 *     hint. This is Hover's "Local CLI Agent First" default — the CLI uses
 *     its own logged-in subscription.
 *
 *   • BYOK — bring your own API key. Pick a protocol (Anthropic / OpenAI /
 *     Azure OpenAI / Google Gemini) and optionally a gateway preset
 *     (Ollama Cloud / SenseAudio / AIHubMix); supply key + base URL + model.
 *     Hover injects these into the protocol's matching CLI via env vars — it
 *     does NOT ship its own model runtime, so the matching CLI must be
 *     installed. The API key is stored in VS Code SecretStorage, never config.
 *
 * Below the model tabs: speech narration, browser silent/visible, and the
 * Hover Cloud placeholder. Reads/writes VS Code config (`hover.*`); changes
 * apply live (model → set-model, byok → set-byok, speech/browser → chat).
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { AgentEntry } from './serviceClient.js';

export interface SettingsByokState {
  protocol: string;
  gateway: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  /** Whether an API key is stored in SecretStorage (the key itself is never
   *  sent to the webview). */
  hasKey: boolean;
}

export interface SettingsChange {
  agent?: string;
  speech?: boolean;
  browser?: string;
  model?: string;
  localBaseUrl?: string;
  localModel?: string;
  /** Which model source tab is active. */
  modelSource?: 'cli' | 'byok';
  byokProtocol?: string;
  byokGateway?: string;
  byokBaseUrl?: string;
  byokModel?: string;
  byokMaxTokens?: number;
  /** API key for the active BYOK protocol → SecretStorage. '' clears it. */
  byokApiKey?: string;
  /** Re-run the PATH scan for installed CLIs. */
  rescan?: boolean;
}

export interface SettingsHandlers {
  /** Coding agents the user can pick. `list` carries the rich availability
   *  the engine reports (label / tagline / installed / installHint / …). */
  getAgents(): { current: string; list: AgentEntry[] };
  /** Current BYOK config (key presence only, never the key). */
  getByok(): SettingsByokState | Promise<SettingsByokState>;
  onChange(change: SettingsChange): void | Promise<void>;
}

/** Static display metadata for agents, so the panel can render a label +
 *  tagline + install hint even before the engine reports availability. The
 *  engine's richer per-agent data (when present) wins. */
const AGENT_META: Record<string, { label: string; tagline: string; hint: string; home: string }> = {
  claude: { label: 'Claude Code', tagline: 'Anthropic official CLI', hint: 'npm i -g @anthropic-ai/claude-code', home: 'https://docs.claude.com/claude-code' },
  codex: { label: 'Codex CLI', tagline: 'OpenAI official CLI', hint: 'npm i -g @openai/codex', home: 'https://github.com/openai/codex' },
  gemini: { label: 'Gemini CLI', tagline: 'Google official CLI', hint: 'npm i -g @google/gemini-cli', home: 'https://github.com/google-gemini/gemini-cli' },
  qwen: { label: 'Local LLM', tagline: 'Self-hosted OpenAI-compatible model (via qwen-code)', hint: 'npm i -g @qwen-code/qwen-code', home: 'https://github.com/QwenLM/qwen-code' },
};

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
    const byok = await this.handlers.getByok();
    const list = agents.list.map((a) => {
      const meta = AGENT_META[a.id];
      return {
        id: a.id,
        label: a.label || meta?.label || a.id,
        tagline: a.tagline || meta?.tagline || '',
        installed: a.installed !== false,
        sandbox: a.sandboxStrength,
        installHint: a.installHint || meta?.hint || '',
        homepage: a.homepage || meta?.home || '',
      };
    });
    void this.view?.webview.postMessage({
      type: 'state',
      agent: agents.current,
      agents: list,
      speech: cfg.get<boolean>('speech', false),
      browser: cfg.get<string>('browser', 'silent'),
      model: cfg.get<string>('model', 'sonnet'),
      localBaseUrl: cfg.get<string>('localBaseUrl', ''),
      localModel: cfg.get<string>('localModel', ''),
      modelSource: cfg.get<string>('modelSource', 'cli'),
      byok,
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
  /* Follow the active VS Code theme (hex = dark fallbacks); mint accent is the brand. */
  :root {
    --bg: var(--vscode-sideBar-background, #1a1a1a);
    --bg-2: var(--vscode-editorWidget-background, #222224);
    --bg-3: var(--vscode-input-background, #141414);
    --line: var(--vscode-widget-border, var(--vscode-editorWidget-border, var(--vscode-panel-border, #2a2a2c)));
    --text: var(--vscode-foreground, #e5e7eb);
    --mute: var(--vscode-descriptionForeground, #9ca3af);
    --dim: var(--vscode-disabledForeground, #6b7280);
    --accent:#7CFFA8; --warn: var(--vscode-editorWarning-foreground, #fb923c);
  }
  body.vscode-light, body.vscode-high-contrast-light { --accent:#16a34a; }
  * { box-sizing: border-box; }
  body { margin:0; padding:12px; font-family: var(--vscode-font-family); font-size:13px; color:var(--text); background:var(--bg); }
  a { color:var(--vscode-textLink-foreground, #7cc7ff); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .label { display:flex; flex-direction:column; gap:2px; }
  .label .sub { color:var(--dim); font-size:11px; }
  select, input { background:var(--bg-3); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:5px 8px; font:inherit; }
  input { width:100%; }
  /* toggle */
  .switch { position:relative; width:38px; height:22px; flex:none; }
  .switch input { display:none; }
  .slider { position:absolute; inset:0; background:var(--line); border-radius:999px; cursor:pointer; transition:.15s; }
  .slider:before { content:''; position:absolute; width:16px; height:16px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.15s; }
  .switch input:checked + .slider { background:var(--accent); }
  .switch input:checked + .slider:before { transform:translateX(16px); }
  .cloud .label { opacity:.65; }
  .cloudbtn { flex:none; white-space:nowrap; display:inline-flex; align-items:center; gap:5px; background:var(--bg-3); color:var(--mute); border:1px solid var(--line); border-radius:6px; padding:6px 12px; font:inherit; font-size:12px; opacity:.6; cursor:not-allowed; }
  .txtin { width:100%; padding:7px 9px; border:1px solid var(--line); border-radius:7px; background:var(--bg-3); color:var(--text); font:inherit; font-size:12px; }
  .txtin::placeholder { color:var(--dim); }
  .txtin:focus { outline:none; border-color:var(--vscode-focusBorder); }

  /* ── section + tabs ── */
  .sec-title { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--dim); margin:4px 0 8px; }
  .tabs { display:flex; gap:0; background:var(--bg-3); border:1px solid var(--line); border-radius:9px; padding:3px; margin-bottom:10px; }
  .tab { flex:1; text-align:center; padding:7px 10px; border-radius:6px; cursor:pointer; color:var(--mute); font-size:12.5px; font-weight:500; border:none; background:transparent; transition:.12s; }
  .tab.active { background:var(--bg-2); color:var(--text); box-shadow:0 1px 2px rgba(0,0,0,.3); }
  .panel { display:none; }
  .panel.active { display:block; }
  .hint { color:var(--dim); font-size:11px; margin:2px 0 10px; }

  /* ── Local CLI cards ── */
  .cli-head { display:flex; align-items:center; justify-content:space-between; margin:6px 0 8px; }
  .cli-head .t { font-size:12px; color:var(--mute); }
  .lnkbtn { background:var(--bg-3); color:var(--mute); border:1px solid var(--line); border-radius:6px; padding:4px 9px; font:inherit; font-size:11.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
  .lnkbtn:hover { color:var(--text); border-color:var(--vscode-focusBorder); }
  .card { display:flex; gap:10px; align-items:flex-start; padding:11px; border:1px solid var(--line); border-radius:10px; background:var(--bg-2); margin-bottom:8px; cursor:pointer; position:relative; transition:.12s; }
  .card:hover { border-color:var(--vscode-focusBorder); }
  .card.active { border-color:var(--accent); box-shadow:inset 3px 0 0 var(--accent); }
  .card .ico { flex:none; width:30px; height:30px; border-radius:8px; display:grid; place-items:center; font-weight:700; font-size:14px; color:#0a0a0a; }
  .card .body { flex:1; min-width:0; }
  .card .nm { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .card .nm b { font-size:13px; }
  .card .nm .pill { font-size:9.5px; font-weight:600; padding:1px 6px; border-radius:999px; letter-spacing:.02em; }
  .pill.rec { background:rgba(124,255,168,.16); color:var(--accent); }
  .pill.soft { background:rgba(251,146,60,.16); color:var(--warn); }
  .card .tg { color:var(--dim); font-size:11.5px; margin-top:2px; }
  .card .check { flex:none; color:var(--accent); font-size:15px; opacity:0; }
  .card.active .check { opacity:1; }
  .local-fields { margin-top:9px; display:flex; flex-direction:column; gap:7px; }

  .fold { border:1px solid var(--line); border-radius:9px; margin:10px 0; overflow:hidden; }
  .fold > summary { list-style:none; cursor:pointer; padding:10px 12px; font-size:12px; color:var(--mute); display:flex; align-items:center; gap:7px; }
  .fold > summary::-webkit-details-marker { display:none; }
  .fold > summary .caret { transition:.15s; }
  .fold[open] > summary .caret { transform:rotate(90deg); }
  .grid { display:grid; grid-template-columns:1fr; gap:8px; padding:0 12px 12px; }
  .icard { border:1px solid var(--line); border-radius:9px; padding:10px; background:var(--bg-3); }
  .icard .nm { display:flex; align-items:center; gap:8px; }
  .icard .nm b { font-size:12.5px; }
  .icard .tg { color:var(--dim); font-size:11px; margin-top:2px; }
  .icard .cmd { display:flex; align-items:center; gap:6px; margin-top:8px; }
  .icard code { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--vscode-editor-font-family,monospace); font-size:11px; background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:5px 7px; color:var(--mute); }
  .copy { flex:none; background:var(--bg-2); border:1px solid var(--line); border-radius:6px; color:var(--mute); padding:5px 8px; cursor:pointer; font-size:11px; }
  .copy:hover { color:var(--text); }

  /* ── BYOK ── */
  .pills { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
  .pchip { padding:6px 12px; border-radius:999px; border:1px solid var(--line); background:var(--bg-3); color:var(--mute); font-size:12px; cursor:pointer; transition:.12s; }
  .pchip:hover { color:var(--text); border-color:var(--vscode-focusBorder); }
  .pchip.on { background:var(--accent); color:#0a0a0a; border-color:var(--accent); font-weight:600; }
  .flbl { font-size:12px; color:var(--text); margin:12px 0 5px; display:flex; align-items:center; justify-content:space-between; }
  .flbl .req { color:var(--warn); }
  .flbl .aux { font-size:11px; }
  .ingrp { display:flex; gap:6px; }
  .ingrp .txtin { flex:1; }
  .smbtn { flex:none; background:var(--bg-2); border:1px solid var(--line); border-radius:7px; color:var(--mute); padding:0 11px; font:inherit; font-size:12px; cursor:pointer; }
  .smbtn:hover { color:var(--text); border-color:var(--vscode-focusBorder); }
  .fhint { color:var(--dim); font-size:11px; margin-top:4px; }
  .byok-sec { font-size:13px; font-weight:600; margin:6px 0 2px; }
</style>
</head><body>
  <div class="sec-title">Model</div>
  <div class="tabs">
    <button class="tab" id="tab-cli" data-src="cli">Local CLI</button>
    <button class="tab" id="tab-byok" data-src="byok">BYOK</button>
  </div>

  <!-- ── Local CLI panel ── -->
  <div class="panel" id="panel-cli">
    <div class="hint">The coding-agent CLI that drives runs, using its own logged-in subscription.</div>
    <div class="cli-head">
      <span class="t" id="cli-count">Your CLIs</span>
      <button class="lnkbtn" id="rescan">↻ Rescan</button>
    </div>
    <div id="cli-cards"></div>
    <details class="fold" id="install-fold">
      <summary><span class="caret">▸</span> <span id="install-count">Installable</span></summary>
      <div class="grid" id="install-grid"></div>
    </details>
  </div>

  <!-- ── BYOK panel ── -->
  <div class="panel" id="panel-byok">
    <div class="hint">Bring your own API key. Hover injects it into the protocol's matching CLI — that CLI must be installed.</div>
    <div class="flbl">Protocol</div>
    <div class="pills" id="proto-pills"></div>
    <div class="flbl">Gateway <span class="aux" style="color:var(--dim)">optional</span></div>
    <div class="pills" id="gw-pills"></div>

    <div class="byok-sec" id="byok-sec">API</div>
    <div class="fhint" id="byok-cli-note" style="margin-bottom:6px"></div>

    <div class="flbl">API Key <span class="req">*</span><a id="getkey" class="aux" href="#" target="_blank" rel="noreferrer">Get a key ↗</a></div>
    <div class="ingrp">
      <input class="txtin" id="byok-key" type="password" placeholder="sk-…" />
      <button class="smbtn" id="key-show">Show</button>
    </div>
    <div class="fhint">Stored in VS Code SecretStorage, on this machine only.</div>

    <div class="flbl">Base URL <span class="req">*</span></div>
    <input class="txtin" id="byok-base" type="text" placeholder="https://api.anthropic.com" />
    <div class="fhint">Default endpoint — usually no need to change.</div>

    <div class="flbl">Max tokens <span class="aux" style="color:var(--dim)">optional</span></div>
    <input class="txtin" id="byok-max" type="number" min="0" placeholder="model default" />
    <div class="fhint">Response length cap. Leave empty to use the model's default.</div>

    <div class="flbl">Model <span class="req">*</span></div>
    <input class="txtin" id="byok-model" type="text" placeholder="claude-sonnet-4-5" />
  </div>

  <!-- ── general ── -->
  <div class="sec-title" style="margin-top:16px">General</div>
  <div class="row">
    <div class="label">Speech narration<span class="sub">Speak tool calls + the summary aloud</span></div>
    <label class="switch"><input type="checkbox" id="speech" /><span class="slider"></span></label>
  </div>
  <div class="row">
    <div class="label">Browser<span class="sub">Headless = no window; Normal = shown Chrome</span></div>
    <select id="browser"><option value="silent">Headless</option><option value="visible">Normal</option></select>
  </div>
  <div class="row cloud">
    <div class="label">Hover Cloud<span class="sub">Cross-machine sync, team environments, run dashboards — coming soon.</span></div>
    <button class="cloudbtn" disabled title="Coming with Hover Cloud">☁ Sign in</button>
  </div>

<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  function change(patch){ vscode.postMessage(Object.assign({type:'change'}, patch)); }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── protocol + gateway catalogue (display + CLI mapping + defaults) ──
  var PROTOCOLS = [
    { id:'anthropic', label:'Anthropic',    cli:'Claude Code', base:'https://api.anthropic.com',                model:'claude-sonnet-4-5', keyPh:'sk-ant-…', sec:'Anthropic API',     getkey:'https://console.anthropic.com/settings/keys' },
    { id:'openai',    label:'OpenAI',       cli:'Codex CLI',   base:'https://api.openai.com/v1',                 model:'gpt-5.5',           keyPh:'sk-…',     sec:'OpenAI API',        getkey:'https://platform.openai.com/api-keys' },
    { id:'azure',     label:'Azure OpenAI', cli:'Codex CLI',   base:'https://<resource>.openai.azure.com',       model:'<deployment>',      keyPh:'<azure key>', sec:'Azure OpenAI',   getkey:'https://portal.azure.com' },
    { id:'gemini',    label:'Google Gemini',cli:'Gemini CLI',  base:'https://generativelanguage.googleapis.com', model:'gemini-2.5-pro',    keyPh:'AIza…',    sec:'Google Gemini API', getkey:'https://aistudio.google.com/apikey' }
  ];
  // Gateways are OpenAI-compatible aggregators — selecting one prefills a base
  // URL the user can still edit (presets are starting points, not asserted).
  var GATEWAYS = [
    { id:'ollama-cloud', label:'Ollama Cloud', base:'https://ollama.com/v1' },
    { id:'sense',        label:'SenseAudio',   base:'' },
    { id:'aihubmix',     label:'AIHubMix',     base:'https://aihubmix.com/v1' }
  ];
  function proto(id){ return PROTOCOLS.filter(function(p){return p.id===id;})[0] || PROTOCOLS[0]; }

  var state = { modelSource:'cli', agent:'claude', agents:[], byok:{ protocol:'anthropic', gateway:'none', baseUrl:'', model:'', maxTokens:0, hasKey:false } };

  // ── tabs ──
  var els = {
    tabCli:document.getElementById('tab-cli'), tabByok:document.getElementById('tab-byok'),
    panelCli:document.getElementById('panel-cli'), panelByok:document.getElementById('panel-byok'),
    cliCards:document.getElementById('cli-cards'), cliCount:document.getElementById('cli-count'),
    installFold:document.getElementById('install-fold'), installGrid:document.getElementById('install-grid'), installCount:document.getElementById('install-count'),
    protoPills:document.getElementById('proto-pills'), gwPills:document.getElementById('gw-pills'),
    byokSec:document.getElementById('byok-sec'), byokCliNote:document.getElementById('byok-cli-note'),
    key:document.getElementById('byok-key'), keyShow:document.getElementById('key-show'), getkey:document.getElementById('getkey'),
    base:document.getElementById('byok-base'), max:document.getElementById('byok-max'), model:document.getElementById('byok-model'),
    speech:document.getElementById('speech'), browser:document.getElementById('browser')
  };
  function selectTab(src){
    state.modelSource = src;
    els.tabCli.classList.toggle('active', src==='cli');
    els.tabByok.classList.toggle('active', src==='byok');
    els.panelCli.classList.toggle('active', src==='cli');
    els.panelByok.classList.toggle('active', src==='byok');
  }
  els.tabCli.addEventListener('click', function(){ selectTab('cli'); change({modelSource:'cli'}); });
  els.tabByok.addEventListener('click', function(){ selectTab('byok'); change({modelSource:'byok'}); });
  document.getElementById('rescan').addEventListener('click', function(){ change({rescan:true}); });

  // ── colour for the agent icon badge (stable per id) ──
  var ICO_BG = { claude:'#d97757', codex:'#10a37f', gemini:'#4285f4', qwen:'#7CFFA8' };

  function renderCli(){
    var installed = state.agents.filter(function(a){ return a.installed; });
    var missing = state.agents.filter(function(a){ return !a.installed; });
    els.cliCount.textContent = 'Your CLIs (' + installed.length + ')';
    els.cliCards.innerHTML = '';
    installed.forEach(function(a){
      var card = document.createElement('div'); card.className='card' + (state.modelSource==='cli' && a.id===state.agent ? ' active':'');
      var ico = document.createElement('div'); ico.className='ico'; ico.style.background = ICO_BG[a.id]||'#888'; ico.textContent = (a.label||a.id).charAt(0).toUpperCase();
      var body = document.createElement('div'); body.className='body';
      var nm = document.createElement('div'); nm.className='nm';
      var b = document.createElement('b'); b.textContent = a.label; nm.appendChild(b);
      if (a.id==='claude') { var rec=document.createElement('span'); rec.className='pill rec'; rec.textContent='Recommended'; nm.appendChild(rec); }
      if (a.sandbox==='soft') { var sf=document.createElement('span'); sf.className='pill soft'; sf.textContent='⚠ Soft sandbox'; nm.appendChild(sf); }
      var tg = document.createElement('div'); tg.className='tg'; tg.textContent = a.tagline||'';
      body.appendChild(nm); body.appendChild(tg);
      // Local LLM (qwen) endpoint fields, inline when it's the active CLI.
      if (a.id==='qwen' && state.modelSource==='cli' && state.agent==='qwen') {
        var lf = document.createElement('div'); lf.className='local-fields';
        var u = document.createElement('input'); u.className='txtin'; u.type='text'; u.placeholder='Base URL — http://localhost:11434/v1'; u.value = state.localBaseUrl||'';
        var m = document.createElement('input'); m.className='txtin'; m.type='text'; m.placeholder='Model — e.g. qwen2.5-coder'; m.value = state.localModel||'';
        u.addEventListener('change', function(){ change({localBaseUrl:u.value.trim()}); });
        m.addEventListener('change', function(){ change({localModel:m.value.trim()}); });
        u.addEventListener('click', function(e){ e.stopPropagation(); });
        m.addEventListener('click', function(e){ e.stopPropagation(); });
        lf.appendChild(u); lf.appendChild(m); body.appendChild(lf);
      }
      var ck = document.createElement('div'); ck.className='check'; ck.textContent='✓';
      card.appendChild(ico); card.appendChild(body); card.appendChild(ck);
      card.addEventListener('click', function(){ state.agent=a.id; selectTab('cli'); change({modelSource:'cli', agent:a.id}); renderCli(); });
      els.cliCards.appendChild(card);
    });
    if (!installed.length) {
      var none = document.createElement('div'); none.className='hint'; none.textContent='No coding-agent CLI found on your PATH. Install one below, then Rescan.';
      els.cliCards.appendChild(none);
    }
    // installable list
    els.installCount.textContent = 'Installable (' + missing.length + ')';
    els.installFold.style.display = missing.length ? '' : 'none';
    els.installGrid.innerHTML = '';
    missing.forEach(function(a){
      var ic = document.createElement('div'); ic.className='icard';
      var nm = document.createElement('div'); nm.className='nm';
      var b = document.createElement('b'); b.textContent = a.label; nm.appendChild(b);
      if (a.homepage) { var hl=document.createElement('a'); hl.href=a.homepage; hl.target='_blank'; hl.rel='noreferrer'; hl.textContent='↗'; hl.style.marginLeft='auto'; nm.appendChild(hl); }
      var tg = document.createElement('div'); tg.className='tg'; tg.textContent = a.tagline||'';
      ic.appendChild(nm); ic.appendChild(tg);
      if (a.installHint) {
        var cmd = document.createElement('div'); cmd.className='cmd';
        var code = document.createElement('code'); code.textContent = a.installHint;
        var cp = document.createElement('button'); cp.className='copy'; cp.textContent='Copy';
        cp.addEventListener('click', function(){ navigator.clipboard.writeText(a.installHint); cp.textContent='Copied'; setTimeout(function(){cp.textContent='Copy';},1200); });
        cmd.appendChild(code); cmd.appendChild(cp); ic.appendChild(cmd);
      }
      els.installGrid.appendChild(ic);
    });
  }

  // ── BYOK ──
  function renderByokChrome(){
    var p = proto(state.byok.protocol);
    els.protoPills.innerHTML = '';
    PROTOCOLS.forEach(function(it){
      var c = document.createElement('button'); c.className='pchip'+(it.id===state.byok.protocol?' on':''); c.textContent=it.label;
      c.addEventListener('click', function(){ setProtocol(it.id); });
      els.protoPills.appendChild(c);
    });
    els.gwPills.innerHTML = '';
    GATEWAYS.forEach(function(g){
      var c = document.createElement('button'); c.className='pchip'+(g.id===state.byok.gateway?' on':''); c.textContent=g.label;
      c.addEventListener('click', function(){ toggleGateway(g.id); });
      els.gwPills.appendChild(c);
    });
    els.byokSec.textContent = p.sec;
    els.byokCliNote.textContent = 'Driven via ' + p.cli + ' — it must be installed.';
    els.getkey.href = p.getkey;
    els.key.placeholder = p.keyPh;
    els.base.placeholder = p.base;
    els.model.placeholder = p.model;
  }
  function syncByokInputs(){
    els.key.value = state.byok.hasKey ? '••••••••••••' : '';
    els.key.type = 'password'; els.keyShow.textContent='Show';
    els.base.value = state.byok.baseUrl||'';
    els.model.value = state.byok.model||'';
    els.max.value = state.byok.maxTokens ? String(state.byok.maxTokens) : '';
  }
  function setProtocol(id){
    state.byok.protocol = id; state.byok.gateway='none';
    // Switching protocol resets to that protocol's default base (gateway cleared).
    state.byok.baseUrl=''; renderByokChrome(); syncByokInputs();
    change({byokProtocol:id, byokGateway:'none', byokBaseUrl:''});
  }
  function toggleGateway(id){
    var on = state.byok.gateway===id;
    state.byok.gateway = on ? 'none' : id;
    var g = GATEWAYS.filter(function(x){return x.id===id;})[0];
    if (!on && g && g.base) { state.byok.baseUrl = g.base; }
    if (on) { state.byok.baseUrl=''; }
    renderByokChrome(); syncByokInputs();
    change({byokGateway:state.byok.gateway, byokBaseUrl:state.byok.baseUrl});
  }
  els.keyShow.addEventListener('click', function(){
    if (els.key.type==='password' && state.byok.hasKey && els.key.value.indexOf('•')===0) {
      // masked stored key — can't reveal a secret we never received; let the user retype.
      els.key.value=''; els.key.type='text'; els.keyShow.textContent='Hide'; els.key.focus(); return;
    }
    var show = els.key.type==='password'; els.key.type = show?'text':'password'; els.keyShow.textContent = show?'Hide':'Show';
  });
  els.key.addEventListener('change', function(){
    var v = els.key.value; if (v.indexOf('•')===0) return; // untouched mask
    state.byok.hasKey = !!v.trim(); change({byokApiKey:v.trim()});
  });
  els.base.addEventListener('change', function(){ state.byok.baseUrl=els.base.value.trim(); change({byokBaseUrl:state.byok.baseUrl}); });
  els.model.addEventListener('change', function(){ state.byok.model=els.model.value.trim(); change({byokModel:state.byok.model}); });
  els.max.addEventListener('change', function(){ var n=parseInt(els.max.value,10); state.byok.maxTokens = isNaN(n)||n<0?0:n; change({byokMaxTokens:state.byok.maxTokens}); });

  els.speech.addEventListener('change', function(){ change({speech: els.speech.checked}); });
  els.browser.addEventListener('change', function(){ change({browser: els.browser.value}); });

  window.addEventListener('message', function(e){ var m=e.data; if(!m||m.type!=='state') return;
    state.agent = m.agent||'claude';
    state.agents = m.agents||[];
    state.localBaseUrl = m.localBaseUrl||''; state.localModel = m.localModel||'';
    state.byok = Object.assign({ protocol:'anthropic', gateway:'none', baseUrl:'', model:'', maxTokens:0, hasKey:false }, m.byok||{});
    selectTab(m.modelSource==='byok'?'byok':'cli');
    els.speech.checked = !!m.speech; els.browser.value = m.browser||'silent';
    renderCli(); renderByokChrome(); syncByokInputs();
  });
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
