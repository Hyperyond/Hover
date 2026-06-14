/**
 * The Hover chat panel — a webview view.
 *
 * Brand identity (mint/dark, lifted from @hover-dev/widget-bootstrap) with the
 * input box refined to mirror Claude Code's: a single rounded container with a
 * toolbar row inside it (model selector left; voice + send right), send arrow
 * pointing UP. No Record/Fix. Header carries the agent/model pill (click to
 * switch), saved-sessions, GitHub star, and new-session. Empty state mirrors
 * the product mock ("Describe what you want to verify…").
 *
 * UI shell + message bus. Header buttons post `{type:'command', id}` which the
 * extension executes; the engine wiring of `send` (run a prompt → stream steps
 * → crystallize) is the next slice — see onSend.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

type Inbound =
  | { type: 'send'; text: string }
  | { type: 'command'; id: string }
  | { type: 'ready' };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.chat';
  private view?: vscode.WebviewView;
  /** Set by the extension: hand a prompt to the engine. */
  runHandler?: (prompt: string) => void;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: Inbound) => {
      if (msg.type === 'send') void this.onSend(msg.text);
      else if (msg.type === 'command' && typeof msg.id === 'string') void vscode.commands.executeCommand(msg.id);
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  /** Reveal + focus the chat (used by New Session). */
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand('hover.chat.focus');
  }

  /** Clear the transcript for a new session. */
  newSession(): void {
    this.post({ type: 'reset' });
  }

  updateMode(id: string | null, label: string | null): void {
    this.post({ type: 'mode', id, label: label ?? 'Default' });
  }
  updateStatus(text: string): void {
    this.post({ type: 'status', text });
  }
  /** App/dev-server status shown top-right (url + reachability). */
  updateApp(online: boolean, url: string | null): void {
    this.post({ type: 'appstatus', online, url });
  }
  updateAgent(label: string): void {
    this.post({ type: 'agent', label });
  }

  // Streamed run rendering (called by the extension as engine events arrive).
  pushStep(label: string): void {
    this.post({ type: 'step', label });
  }
  pushAssistant(text: string): void {
    this.post({ type: 'assistant', text });
  }
  pushSystem(text: string): void {
    this.post({ type: 'system', text });
  }
  pushResult(verdict: string, summary: string, steps?: number): void {
    this.post({ type: 'result', verdict, summary, steps });
  }
  setRunning(running: boolean): void {
    this.post({ type: 'running', running });
  }

  private onSend(text: string): void {
    const prompt = text.trim();
    if (!prompt) return;
    this.post({ type: 'user', text: prompt });
    if (this.runHandler) this.runHandler(prompt);
    else this.post({ type: 'system', text: 'Engine not available.' });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`, `media-src 'self'`].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root {
    --bg: #1a1a1a; --bg-2: #222224; --bg-3: #141414; --line: #2a2a2c;
    --text: #e5e7eb; --text-mute: #9ca3af; --text-dim: #6b7280;
    --accent: #7CFFA8; --accent-dim: rgba(124,255,168,0.16); --accent-ink: #0c2417;
  }
  body.mode-security { --accent: #fb923c; --accent-dim: rgba(251,146,60,0.16); --accent-ink: #2a1605; }
  body.mode-pentest  { --accent: #f87171; --accent-dim: rgba(248,113,113,0.16); --accent-ink: #2a0d0d; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
    font-size: 13px; color: var(--text); background: var(--bg);
  }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }

  header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg-2); color: var(--text); cursor: pointer; font: inherit; }
  .pill:hover { border-color: var(--accent); }
  .caret { color: var(--text-dim); }
  .iconbtn { display: inline-flex; padding: 5px; border: none; background: none; color: var(--text-mute); cursor: pointer; border-radius: 6px; }
  .iconbtn:hover { color: var(--text); background: var(--bg-2); }
  .spacer { flex: 1; }
  .appstatus { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border: none; border-radius: 7px; background: none; color: var(--text-mute); font: inherit; font-size: 12px; cursor: pointer; }
  .appstatus:hover { background: var(--bg-2); color: var(--text); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .dot.offline { background: var(--text-dim); }

  #log { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 8px; }
  .empty { margin: auto; text-align: center; color: var(--text-dim); padding: 0 26px; line-height: 1.55; }
  .empty em { color: var(--text-mute); font-style: normal; }
  .startapp { margin-top: 16px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border: 1px solid var(--accent); border-radius: 8px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
  .startapp:hover { background: var(--accent); color: var(--accent-ink); }
  .working { display: flex; align-items: center; gap: 9px; padding: 8px 11px; color: var(--text-mute); font-size: 12px; }
  .working .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: hoverpulse 1s ease-in-out infinite; }
  @keyframes hoverpulse { 0%,100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.12); } }
  .msg { padding: 8px 11px; border-radius: 10px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; max-width: 88%; background: var(--accent); color: var(--accent-ink); font-weight: 500; }
  .msg.assistant { align-self: flex-start; max-width: 88%; background: var(--bg-2); border: 1px solid var(--line); }
  .msg.system { align-self: stretch; font-size: 12px; color: var(--text-mute); background: var(--bg-2); border: 1px solid var(--line); }
  .step { display: flex; align-items: center; gap: 9px; padding: 9px 11px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 9px; }
  .step .check { color: var(--accent); font-weight: 700; }
  .step .label { flex: 1; }
  .result { border: 1px solid var(--accent); border-radius: 12px; background: var(--accent-dim); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .result .head { font-weight: 700; color: var(--accent); }
  .saveas { align-self: flex-start; padding: 6px 11px; border: 1px solid var(--accent); border-radius: 7px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
  .saveas:hover { background: var(--accent); color: var(--accent-ink); }

  /* Claude-Code-style input box: one rounded container, toolbar row inside. */
  #composer { padding: 10px 12px 12px; }
  #box {
    border: 1px solid var(--line); border-radius: 12px; background: var(--bg-3);
    padding: 8px 10px 8px; display: flex; flex-direction: column; gap: 6px;
    transition: border-color .12s ease;
  }
  #box:focus-within { border-color: var(--accent); }
  #input {
    width: 100%; resize: none; min-height: 22px; max-height: 160px;
    border: none; outline: none; background: transparent; color: var(--text);
    font: inherit; line-height: 1.45; padding: 2px 0;
  }
  #input::placeholder { color: var(--text-dim); }
  /* Text row: textarea + mic top-right (Claude-Code-style). */
  .inputrow { display: flex; align-items: flex-start; gap: 6px; }
  .inputrow #input { flex: 1; }
  #toolbar { display: flex; align-items: center; gap: 6px; }
  #toolbar .left { display: flex; align-items: center; gap: 6px; }
  #toolbar .right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .modelpill, .modepill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg-2); color: var(--text-mute); cursor: pointer; font: inherit; font-size: 12px; }
  .modelpill:hover, .modepill:hover { border-color: var(--accent); color: var(--text); }
  /* Mode pill tints to the active mode (mirrors the body mode class). */
  .modepill .bolt { color: var(--accent); }
  body.mode-security .modepill, body.mode-pentest .modepill { border-color: var(--accent); color: var(--accent); }
  #mic { display: inline-flex; padding: 5px; border: none; background: none; color: var(--text-mute); cursor: pointer; border-radius: 7px; margin-top: 1px; }
  #mic:hover { color: var(--text); background: var(--bg-2); }
  #mic.recording { color: var(--accent); }
  #send {
    width: 30px; height: 30px; border: none; border-radius: 8px; cursor: pointer;
    background: var(--accent); color: var(--accent-ink);
    display: inline-flex; align-items: center; justify-content: center;
  }
  #send:hover { filter: brightness(1.08); }
  #send:disabled { opacity: .45; cursor: default; }
</style>
</head>
<body>
  <header>
    <button class="iconbtn" id="history" type="button" title="Session history">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>
    </button>
    <button class="iconbtn" id="new" type="button" title="New session">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
    </button>
    <span class="spacer"></span>
    <button class="appstatus" id="appstatus" type="button" title="App URL — click to set / start">
      <span class="dot offline" id="app-dot"></span><span id="app-label">detecting…</span>
    </button>
  </header>

  <div id="log"><div class="empty">Describe what you want to verify, e.g. <em>"test the login flow"</em>.<br/><button class="startapp" id="startapp">▶ Start App</button></div></div>

  <div id="composer">
    <div id="box">
      <div class="inputrow">
        <textarea id="input" rows="1" placeholder="e.g. test the login flow"></textarea>
        <button id="mic" type="button" title="Voice input">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2"/></svg>
        </button>
      </div>
      <div id="toolbar">
        <div class="left">
          <button class="modelpill" id="model" type="button" title="Switch agent / model"><span id="model-label">Claude</span><span class="caret">▾</span></button>
        </div>
        <div class="right">
          <button class="modepill" id="mode" type="button" title="Switch mode (Testing / Security / Pentest)"><span class="bolt">⚡</span><span id="mode-label">Normal</span><span class="caret">▾</span></button>
          <button id="send" type="button" title="Send (Enter)" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var log = document.getElementById('log');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var cleared = false;

  function fresh() { if (!cleared) { log.innerHTML = ''; cleared = true; } }
  function scroll() { if (typeof workingEl !== 'undefined' && workingEl && running && workingEl.parentNode) log.appendChild(workingEl); log.scrollTop = log.scrollHeight; }
  function addMessage(role, text) { fresh(); var el = document.createElement('div'); el.className = 'msg ' + role; el.textContent = text; log.appendChild(el); scroll(); }
  function addStep(label) { fresh(); var el = document.createElement('div'); el.className = 'step'; var c = document.createElement('span'); c.className = 'check'; c.textContent = '✓'; var l = document.createElement('span'); l.className = 'label'; l.textContent = label; el.appendChild(c); el.appendChild(l); log.appendChild(el); scroll(); }
  function addResult(verdict, summary, steps) { fresh(); var card = document.createElement('div'); card.className = 'result'; var h = document.createElement('div'); h.className = 'head'; h.textContent = '✓ ' + (verdict || 'PASS') + (steps ? ' — done in ' + steps + ' steps' : ''); var b = document.createElement('div'); b.textContent = summary || ''; var s = document.createElement('button'); s.className = 'saveas'; s.textContent = 'Save as spec'; s.addEventListener('click', function(){ vscode.postMessage({ type:'command', id:'hover.saveSpec' }); }); card.appendChild(h); card.appendChild(b); card.appendChild(s); log.appendChild(card); scroll(); }

  var running = false;
  var iconSend = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  var iconStop = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  function syncSend() {
    if (running) { sendBtn.disabled = false; sendBtn.innerHTML = iconStop; sendBtn.title = 'Stop'; }
    else { sendBtn.disabled = input.value.trim().length === 0; sendBtn.innerHTML = iconSend; sendBtn.title = 'Send (Enter)'; }
  }
  function submit() {
    if (running) { vscode.postMessage({ type:'command', id:'hover.cancelRun' }); return; }
    var t = input.value.trim(); if (!t) return;
    vscode.postMessage({ type:'send', text:t }); input.value=''; input.style.height='auto'; syncSend();
  }
  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', function(e){ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  input.addEventListener('input', function(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,160)+'px'; syncSend(); });

  function cmd(id){ return function(){ vscode.postMessage({ type:'command', id:id }); }; }
  document.getElementById('model').addEventListener('click', cmd('hover.switchAgent'));
  document.getElementById('mode').addEventListener('click', cmd('hover.switchMode'));
  document.getElementById('history').addEventListener('click', cmd('hover.sessions.focus'));
  document.getElementById('new').addEventListener('click', cmd('hover.newSession'));
  document.getElementById('appstatus').addEventListener('click', cmd('hover.appStatus'));
  // Delegated: the ▶ Start App button lives inside the (re-rendered) empty state.
  log.addEventListener('click', function(e){ if (e.target && e.target.closest && e.target.closest('#startapp')) vscode.postMessage({ type:'command', id:'hover.startApp' }); });

  var workingEl = null;
  function setWorking(on){
    if (on) { fresh(); if (!workingEl) { workingEl = document.createElement('div'); workingEl.className='working'; workingEl.innerHTML='<span class="pulse"></span><span>Working…</span>'; } log.appendChild(workingEl); scroll(); }
    else if (workingEl && workingEl.parentNode) { workingEl.parentNode.removeChild(workingEl); }
  }

  // Voice input (best-effort; webview may lack mic permission — degrade quietly).
  var mic = document.getElementById('mic');
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, recording = false;
  if (!Rec) { mic.title = 'Voice input not available here'; }
  mic.addEventListener('click', function(){
    if (!Rec) { addMessage('system', 'Voice input is not available in this webview.'); return; }
    if (recording) { try { rec && rec.stop(); } catch(e){} return; }
    try {
      rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = true;
      rec.onstart = function(){ recording = true; mic.classList.add('recording'); };
      rec.onend = function(){ recording = false; mic.classList.remove('recording'); };
      rec.onerror = function(){ recording = false; mic.classList.remove('recording'); };
      rec.onresult = function(e){ var t=''; for (var i=0;i<e.results.length;i++) t+=e.results[i][0].transcript; input.value=t; syncSend(); };
      rec.start();
    } catch(e) { addMessage('system', 'Could not start voice input.'); }
  });

  window.addEventListener('message', function(e){
    var m = e.data; if (!m) return;
    if (m.type==='user'||m.type==='system'||m.type==='assistant') addMessage(m.type, m.text);
    else if (m.type==='step') addStep(m.label);
    else if (m.type==='result') addResult(m.verdict, m.summary, m.steps);
    else if (m.type==='reset') { log.innerHTML=''; cleared=false; log.appendChild(emptyEl()); input.value=''; syncSend(); }
    else if (m.type==='mode') { document.body.className = m.id ? 'mode-'+m.id : ''; document.getElementById('mode-label').textContent = m.id ? (m.label||m.id) : 'Normal'; }
    else if (m.type==='agent') { document.getElementById('model-label').textContent = m.label || 'Claude'; }
    else if (m.type==='appstatus') {
      var dot=document.getElementById('app-dot'); var lab=document.getElementById('app-label');
      if (m.url) { var short=String(m.url).replace(/^https?:\\/\\//,'').replace(/\\/$/,''); lab.textContent = m.online ? short : short+' (offline)'; dot.className = m.online ? 'dot' : 'dot offline'; }
      else { lab.textContent='Set app URL'; dot.className='dot offline'; }
    }
    else if (m.type==='running') { running = !!m.running; setWorking(running); syncSend(); }
  });
  function emptyEl(){ var d=document.createElement('div'); d.className='empty'; d.innerHTML='Describe what you want to verify, e.g. <em>"test the login flow"</em>.<br/><button class="startapp" id="startapp">▶ Start App</button>'; return d; }

  syncSend();
  vscode.postMessage({ type:'ready' });
</script>
</body>
</html>`;
  }
}

export function registerChatView(): { provider: ChatViewProvider; disposable: vscode.Disposable } {
  const provider = new ChatViewProvider();
  const disposable = vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposable };
}
