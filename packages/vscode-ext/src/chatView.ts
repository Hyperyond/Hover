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
  | { type: 'setMode'; modeId: string | null }
  | { type: 'setModel'; value: string }
  | { type: 'ready' };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.chat';
  private view?: vscode.WebviewView;
  /** Set by the extension: hand a prompt to the engine. */
  runHandler?: (prompt: string) => void;
  /** Set by the extension: the webview (re)loaded — re-push config / accounts /
   *  status, which would otherwise be lost if it resolves after activate. */
  onReady?: () => void;
  /** Set by the extension: the user picked a mode (null = normal) / a model. */
  modeHandler?: (modeId: string | null) => void;
  modelHandler?: (value: string) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: Inbound) => {
      if (msg.type === 'send') void this.onSend(msg.text);
      else if (msg.type === 'command' && typeof msg.id === 'string') void vscode.commands.executeCommand(msg.id);
      else if (msg.type === 'setMode') this.modeHandler?.(msg.modeId);
      else if (msg.type === 'setModel' && typeof msg.value === 'string') this.modelHandler?.(msg.value);
      else if (msg.type === 'ready') this.onReady?.();
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
  /** Active-environment status shown top-right (label + reachability; the full
   *  URL is the tooltip). `label` is the env name for remote targets, or the
   *  host:port for Local. */
  updateApp(online: boolean, label: string | null, title?: string): void {
    this.post({ type: 'appstatus', online, label, title: title ?? label });
  }
  /** Active environment's test accounts for the `@` autocomplete (no passwords). */
  updateAccounts(accounts: { label: string; role?: string; username?: string }[]): void {
    this.post({ type: 'accounts', accounts });
  }
  /** Push live config to the webview (drives voice + the silent-run border). */
  updateConfig(speech: boolean, silent: boolean): void {
    this.post({ type: 'config', speech, silent });
  }
  /** Push the model picker's list for the current agent + the active model. */
  updateModels(models: { value: string; label: string; desc?: string }[], current: string): void {
    this.post({ type: 'models', models, current });
  }

  // Streamed run rendering (called by the extension as engine events arrive).
  pushStep(step: { label: string; tool?: string; detail?: string; cost?: number }): void {
    this.post({ type: 'step', ...step });
  }
  /** AI narration → the next step group's title. */
  pushNarration(text: string): void {
    this.post({ type: 'narration', text });
  }
  pushAssistant(text: string): void {
    this.post({ type: 'assistant', text });
  }
  pushSystem(text: string): void {
    this.post({ type: 'system', text });
  }
  pushResult(verdict: string, summary: string, steps?: number, cost?: number): void {
    this.post({ type: 'result', verdict, summary, steps, cost });
  }
  setRunning(running: boolean): void {
    this.post({ type: 'running', running });
  }
  /** Show a live spinner row with an elapsed timer for an out-of-band job
   *  (e.g. spec optimization, which streams no step events). */
  pushBusy(text: string): void {
    this.post({ type: 'busy', text });
  }
  /** Clear the spinner row started by pushBusy(). */
  clearBusy(): void {
    this.post({ type: 'busy', done: true });
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
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`, `media-src 'self'`, `img-src ${webview.cspSource}`].join('; ');
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.png'));
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
    --warn: #fb923c; --err: #f87171; --link: #7dd3fc;
  }
  body.mode-security { --accent: #fb923c; --accent-dim: rgba(251,146,60,0.16); --accent-ink: #2a1605; }
  body.mode-pentest  { --accent: #f87171; --accent-dim: rgba(248,113,113,0.16); --accent-ink: #2a0d0d; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family, -apple-system, system-ui, sans-serif);
    font-size: 13px; color: var(--text); background: var(--bg);
  }
  /* Silent mode + running: a rotating Google-Chrome-colored border, signalling
     the invisible browser is working (the page itself you can't see). */
  @property --hov-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
  body.silent-running::after {
    content: ''; position: fixed; inset: 0; z-index: 9999; pointer-events: none; padding: 2.5px;
    background: conic-gradient(from var(--hov-angle), #4285F4, #EA4335, #FBBC05, #34A853, #4285F4);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: hov-spinborder 2.4s linear infinite;
  }
  @keyframes hov-spinborder { to { --hov-angle: 360deg; } }
  /* Security mode running → orange border; pentest → red. Pulsing glow. */
  body.border-security::after, body.border-pentest::after {
    content: ''; position: fixed; inset: 0; z-index: 9999; pointer-events: none; padding: 2.5px;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: hov-bpulse 1.6s ease-in-out infinite;
  }
  body.border-security::after { background: #fb923c; }
  body.border-pentest::after { background: #f87171; }
  @keyframes hov-bpulse { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
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
  /* Branded launch splash (Codex-style): mark + wordmark + tagline + site link. */
  .splash { display: flex; flex-direction: column; align-items: center; height: 100%; padding: 24px 20px 8px; }
  .splash-hero { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
  .splash-mark { width: 76px; height: 76px; border-radius: 18px; }
  .splash-name { font-size: 30px; font-weight: 700; letter-spacing: .08em; color: var(--text); }
  .splash-tag { color: var(--text-dim); line-height: 1.55; max-width: 320px; }
  .splash-tag em { color: var(--text-mute); font-style: normal; }
  .splash-link { margin-top: auto; padding-top: 14px; color: var(--text-mute); font-size: 12px; cursor: pointer; text-decoration: none; }
  .splash-link:hover { color: var(--accent); }
  .startapp { margin-top: 4px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border: 1px solid var(--accent); border-radius: 8px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
  .startapp:hover { background: var(--accent); color: var(--accent-ink); }
  .working { display: flex; align-items: center; gap: 9px; padding: 8px 11px; color: var(--text-mute); font-size: 12px; }
  .working .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: hoverpulse 1s ease-in-out infinite; }
  .working .busy-time { opacity: .6; font-variant-numeric: tabular-nums; }
  @keyframes hoverpulse { 0%,100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.12); } }
  .msg { padding: 8px 11px; border-radius: 10px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; max-width: 88%; background: var(--accent); color: var(--accent-ink); font-weight: 500; }
  .msg.assistant { align-self: flex-start; max-width: 88%; background: var(--bg-2); border: 1px solid var(--line); }
  .msg.system { align-self: stretch; font-size: 12px; color: var(--text-mute); background: var(--bg-2); border: 1px solid var(--line); }
  .step { background: var(--bg-2); border: 1px solid var(--line); border-radius: 9px; padding: 8px 11px; }
  .step-head { display: flex; align-items: center; gap: 9px; }
  .step-icon { width: 14px; height: 14px; flex: none; text-align: center; }
  .step-icon.check { color: var(--accent); font-weight: 700; }
  .step-icon.spin { border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: hoverspin .7s linear infinite; box-sizing: border-box; }
  @keyframes hoverspin { to { transform: rotate(360deg); } }
  .step .label { flex: 1; }
  .step-meta { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
  .step-caret { color: var(--text-dim); font-size: 11px; }
  .step-detail { margin: 6px 0 0; padding: 8px; background: var(--bg-3); border-radius: 6px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 11px; white-space: pre-wrap; overflow: auto; max-height: 240px; }
  /* grouped run rendering — ported from the widget (style.css .group*). */
  .group { background: var(--bg-2); border: 1px solid var(--line); border-radius: 9px; }
  .group-row { display: flex; align-items: center; gap: 10px; padding: 9px 11px; cursor: pointer; user-select: none; }
  .gr-chevron { width: 12px; flex-shrink: 0; color: var(--text-dim); font-size: 9px; text-align: center; transition: transform .12s ease, color .12s ease; }
  .group.open .gr-chevron { transform: rotate(90deg); color: var(--text-mute); }
  .gr-icon { width: 16px; height: 16px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; line-height: 1; border-radius: 50%; font-weight: 700; }
  .group.ok .gr-icon { color: var(--accent); background: rgba(124,255,168,0.12); }
  .group.error .gr-icon { color: var(--err); background: rgba(248,113,113,0.14); }
  .group.running .gr-icon { color: var(--accent); background: transparent; }
  .gr-icon.gr-ring { width: 12px; height: 12px; border: 1.5px solid var(--accent); border-top-color: transparent; border-radius: 50%; background: transparent; animation: hov-grspin .9s linear infinite; font-size: 0; }
  @keyframes hov-grspin { to { transform: rotate(360deg); } }
  .gr-title { flex: 1; min-width: 0; font-size: 13px; color: var(--text); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group.running .gr-title { color: var(--accent); }
  .group.error .gr-title { color: var(--err); }
  .gr-meta { flex-shrink: 0; font-size: 10.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .gr-meta .gr-cost { color: var(--accent); }
  .group.error .gr-meta .gr-cost { color: var(--err); }
  .group-tools { display: none; padding: 0 10px 8px 36px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 11px; color: var(--text-mute); }
  .group.open .group-tools { display: block; }
  .group-tool { display: flex; gap: 6px; padding: 2px 0; align-items: flex-start; }
  .gt-dot { color: var(--text-dim); flex-shrink: 0; }
  .gt-name { color: var(--link); flex-shrink: 0; white-space: nowrap; }
  .group-tool.error .gt-name { color: var(--err); }
  .gt-args { color: var(--text-dim); min-width: 0; word-break: break-all; overflow-wrap: anywhere; }
  .result { border: 1px solid var(--accent); border-radius: 12px; background: var(--accent-dim); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .result .head { font-weight: 700; color: var(--accent); }
  .md { line-height: 1.5; }
  .md h4 { font-size: 1em; margin: 8px 0 4px; }
  .md div { margin: 2px 0; }
  .md code { background: var(--bg-3); padding: 1px 4px; border-radius: 4px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .md table { border-collapse: collapse; margin: 6px 0; font-size: 12px; }
  .md th, .md td { border: 1px solid var(--line); padding: 3px 7px; text-align: left; }
  .md ul { margin: 4px 0; padding-left: 18px; }
  .saveas { align-self: flex-start; padding: 6px 11px; border: 1px solid var(--accent); border-radius: 7px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
  .saveas:hover { background: var(--accent); color: var(--accent-ink); }
  .findings { border: 1px solid var(--warn); border-radius: 12px; background: rgba(251,146,60,0.10); padding: 12px; display: flex; flex-direction: column; gap: 7px; }
  .findings .fhead { font-weight: 700; color: var(--warn); }
  .finding { display: flex; gap: 8px; align-items: flex-start; line-height: 1.45; }
  .badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; flex: none; text-transform: uppercase; letter-spacing: .03em; }
  .badge.bug { background: #f87171; color: #240808; }
  .badge.minor { background: var(--warn); color: #241805; }
  .badge.info { background: var(--line); color: var(--text); }

  /* Claude-Code-style input box: one rounded container, toolbar row inside. */
  #composer { padding: 10px 12px 12px; position: relative; }
  .mentions { position: absolute; left: 12px; right: 12px; bottom: calc(100% - 6px); z-index: 20;
    background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
    box-shadow: 0 8px 24px rgba(0,0,0,.35); max-height: 220px; overflow-y: auto; }
  .m-item { display: flex; align-items: baseline; gap: 8px; padding: 7px 11px; cursor: pointer; font-size: 12px; }
  .m-item .m-label { color: var(--text); font-weight: 600; }
  .m-item .m-sub { color: var(--text-mute); font-size: 11px; }
  .m-item.sel, .m-item:hover { background: var(--bg-3); }
  .m-empty { padding: 8px 11px; color: var(--text-mute); font-size: 11px; }
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
  .inputrow { display: flex; align-items: flex-start; gap: 6px; }
  .inputrow #input { flex: 1; }
  #toolbar { display: flex; align-items: center; gap: 6px; }
  #toolbar .left { display: flex; align-items: center; gap: 6px; }
  #toolbar .right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  /* Borderless toolbar buttons (Claude-Code "auto mode" style): icon + text,
     no chrome, subtle hover. */
  .barebtn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border: none; background: none; color: var(--text-mute); cursor: pointer; font: inherit; font-size: 12px; border-radius: 7px; }
  .barebtn:hover { color: var(--text); background: var(--bg-2); }
  .barebtn .caret { color: var(--text-dim); font-size: 10px; }
  .barebtn svg { opacity: .9; }
  /* Mode button tints to the active mode. */
  body.mode-security #mode { color: var(--warn); }
  body.mode-pentest #mode { color: var(--err); }
  /* Popup picker (modes / models) — mimics Claude Code's Modes list. */
  .popup { position: absolute; bottom: calc(100% - 6px); z-index: 30; min-width: 252px; max-width: calc(100% - 24px);
    background: var(--bg-2); border: 1px solid var(--line); border-radius: 10px; overflow: hidden;
    box-shadow: 0 10px 28px rgba(0,0,0,.42); padding: 4px; }
  #model-menu { left: 12px; }
  #mode-menu { right: 12px; }
  .popup .p-hdr { padding: 6px 8px 4px; font-size: 11px; color: var(--text-dim); }
  .p-item { display: flex; gap: 9px; padding: 8px 8px; cursor: pointer; align-items: flex-start; border-radius: 7px; }
  .p-item:hover, .p-item.sel { background: var(--bg-3); }
  .p-item .p-ic { width: 18px; flex: none; text-align: center; color: var(--text-mute); }
  .p-item .p-body { flex: 1; min-width: 0; }
  .p-item .p-title { color: var(--text); font-size: 12.5px; }
  .p-item .p-desc { color: var(--text-mute); font-size: 11px; line-height: 1.4; margin-top: 1px; }
  .p-item .p-check { flex: none; color: var(--accent); opacity: 0; }
  .p-item.active .p-check { opacity: 1; }
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

  <div id="log"></div>

  <div id="composer">
    <div id="mentions" class="mentions" hidden></div>
    <div id="box">
      <div class="inputrow">
        <textarea id="input" rows="1" placeholder="e.g. test the login flow  ·  @account to log in"></textarea>
      </div>
      <div id="model-menu" class="popup" hidden></div>
      <div id="mode-menu" class="popup" hidden></div>
      <div id="toolbar">
        <div class="left">
          <button class="barebtn" id="browser-toggle" type="button" title="Browser: Headless (no window) / Normal (shown) — click to toggle">
            <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M24 6a18 18 0 0 1 15.6 9H24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M8.4 15a18 18 0 0 0 7.8 26.4l7.8-13.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M39.6 15a18 18 0 0 1-15.6 27l7.8-13.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>
            <span id="browser-label">Headless</span>
          </button>
          <button class="barebtn" id="model-btn" type="button" title="Model — click to switch"><span id="model-label">Sonnet 4.6</span><span class="caret">▾</span></button>
        </div>
        <div class="right">
          <button class="barebtn" id="mode" type="button" title="Switch mode (Normal / Security / Pentest)"><span class="bolt" id="mode-icon">⚡</span><span id="mode-label">Normal</span><span class="caret">▾</span></button>
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

  var speechOn = false, silentMode = false, currentModeId = null;
  function speak(text) { if (!speechOn || !text) return; try { if (window.speechSynthesis) { window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(text).slice(0, 300))); } } catch (e) {} }
  // Running-border: pentest → red, security → orange, else silent → Chrome ring.
  function applyBorder() {
    var b = document.body;
    b.classList.remove('silent-running', 'border-security', 'border-pentest');
    if (!running) return;
    if (currentModeId === 'pentest') b.classList.add('border-pentest');
    else if (currentModeId === 'security') b.classList.add('border-security');
    else if (silentMode) b.classList.add('silent-running');
  }
  function fresh() { if (!cleared) { log.innerHTML = ''; cleared = true; } }
  function scroll() { if (typeof workingEl !== 'undefined' && workingEl && running && workingEl.parentNode) log.appendChild(workingEl); log.scrollTop = log.scrollHeight; }
  function addMessage(role, text) { fresh(); var el = document.createElement('div'); el.className = 'msg ' + role; el.textContent = text; log.appendChild(el); if (role === 'assistant') speak(text); scroll(); }
  // ── Grouped run rendering (mirrors the widget): tool steps fold under an
  //    AI-narration title; boundary tools / >6 steps split into a new group. ──
  var BOUNDARY = { browser_navigate: 1, browser_navigate_back: 1, browser_fill_form: 1, TaskCreate: 1 };
  var MAX_GROUP = 6;
  var pendingTitle = null;   // last AI narration, promoted to the next group's title
  var curGroup = null;       // { iconEl, metaEl, stepsEl, count, start, snapStart, snapEnd }

  function shortJson(s) { if (!s) return ''; return s.length > 90 ? s.slice(0, 87) + '…' : s; }
  function setGroupStatus(g, status) {
    var open = g.root.classList.contains('open');
    g.root.className = 'group ' + status + (open ? ' open' : '');
    if (status === 'running') { g.icon.className = 'gr-icon gr-ring'; g.icon.textContent = ''; }
    else { g.icon.className = 'gr-icon'; g.icon.textContent = status === 'error' ? '✗' : '✓'; }
  }
  function setGroupMeta(g, endSnapshot, live) {
    var parts = [((Date.now() - g.start) / 1000).toFixed(1) + 's'];
    var endC = (typeof endSnapshot === 'number') ? endSnapshot : g.snapEnd;
    if (typeof endC === 'number' && typeof g.snapStart === 'number') { var d = endC - g.snapStart; if (d > 0.00005) parts.push('<span class="gr-cost">$' + d.toFixed(4) + '</span>'); }
    if (g.count) parts.push(g.count + (g.count > 1 ? ' steps' : ' step'));
    g.meta.innerHTML = parts.join(' · ') + (live ? '…' : '');
  }
  function finalizeGroup(endSnapshot) {
    if (!curGroup) return;
    setGroupStatus(curGroup, 'ok');
    setGroupMeta(curGroup, endSnapshot, false);
    curGroup = null;
    updateWorking();
  }
  function openGroup(titleText, snapshot) {
    fresh();
    var root = document.createElement('div'); root.className = 'group running';
    var row = document.createElement('div'); row.className = 'group-row';
    var chev = document.createElement('span'); chev.className = 'gr-chevron'; chev.textContent = '▶';
    var icon = document.createElement('span'); icon.className = 'gr-icon gr-ring';
    var t = document.createElement('span'); t.className = 'gr-title'; t.textContent = titleText;
    var meta = document.createElement('span'); meta.className = 'gr-meta';
    row.appendChild(chev); row.appendChild(icon); row.appendChild(t); row.appendChild(meta);
    var tools = document.createElement('div'); tools.className = 'group-tools';
    row.addEventListener('click', function () { root.classList.toggle('open'); });
    root.appendChild(row); root.appendChild(tools);
    log.appendChild(root);
    curGroup = { root: root, icon: icon, meta: meta, tools: tools, count: 0, start: Date.now(), snapStart: (typeof snapshot === 'number' ? snapshot : undefined), snapEnd: undefined };
    updateWorking();
  }
  function addNarration(text) { if (text && text.trim()) pendingTitle = text.trim(); }
  function addStep(m) {
    if (curGroup && (BOUNDARY[m.tool] || curGroup.count >= MAX_GROUP)) finalizeGroup(typeof m.cost === 'number' ? m.cost : undefined);
    if (!curGroup) { openGroup(pendingTitle || m.label, typeof m.cost === 'number' ? m.cost : undefined); pendingTitle = null; }
    var line = document.createElement('div'); line.className = 'group-tool' + (m.isError ? ' error' : '');
    var dot = document.createElement('span'); dot.className = 'gt-dot'; dot.textContent = '·';
    var name = document.createElement('span'); name.className = 'gt-name'; name.textContent = m.tool || m.label;
    var args = document.createElement('span'); args.className = 'gt-args'; args.textContent = ' ' + shortJson(m.detail);
    line.appendChild(dot); line.appendChild(name); line.appendChild(args);
    curGroup.tools.appendChild(line);
    curGroup.count++;
    if (typeof m.cost === 'number') curGroup.snapEnd = m.cost;
    setGroupMeta(curGroup, undefined, true);
    speak(m.label);
    scroll();
  }
  function addResult(m) {
    fresh();
    finalizeGroup(typeof m.cost === 'number' ? m.cost : undefined);
    var parsed = splitFindings(m.summary || '');
    var card = document.createElement('div'); card.className = 'result';
    var h = document.createElement('div'); h.className = 'head';
    h.textContent = '✓ ' + (m.verdict || 'PASS') + (m.steps ? ' — done in ' + m.steps + ' steps' : '') + (typeof m.cost === 'number' && m.cost > 0 ? ' · $' + m.cost.toFixed(4) : '');
    var body = document.createElement('div'); body.className = 'md'; body.innerHTML = mdToHtml(parsed.main);
    // Pentest (🔴) crystallizes a findings REPORT, never a Playwright spec —
    // a regression spec of an attack run is the wrong artifact. Other modes
    // save a spec.
    var isPentest = currentModeId === 'pentest';
    var save = document.createElement('button'); save.className = 'saveas';
    save.textContent = isPentest ? 'Save findings report' : 'Save as spec';
    save.addEventListener('click', function () { vscode.postMessage({ type: 'command', id: isPentest ? 'hover.saveFindingsReport' : 'hover.saveSpec' }); });
    card.appendChild(h); card.appendChild(body); card.appendChild(save);
    log.appendChild(card);
    if (parsed.findings) renderFindings(parsed.findings);
    speak((m.verdict || 'Pass') + '. ' + parsed.main.replace(/[#*\`|>_-]+/g, ' '));
    scroll();
  }
  function sevClass(s) { s = (s || '').toLowerCase(); return (s === 'bug' || s === 'major' || s === 'high' || s === 'critical') ? 'bug' : (s === 'info' || s === 'note' ? 'info' : 'minor'); }
  function renderFindings(text) {
    var card = document.createElement('div'); card.className = 'findings';
    var h = document.createElement('div'); h.className = 'fhead'; h.textContent = '⚠ Findings'; card.appendChild(h);
    text.split('\\n').forEach(function (line) {
      // Match "- **Marker** — rest"  OR a plain "- rest" bullet. Don't blindly
      // strip leading '*' (that would eat the opening ** of a bold marker).
      var m = line.match(/^\\s*[-*]\\s+(?:\\*\\*\\s*([^*]+?)\\s*\\*\\*\\s*[—–:\\-]?\\s*)?([\\s\\S]+)$/);
      if (!m) { var tt = line.trim(); if (!tt) return; m = [null, null, tt]; }
      var marker = m[1], rest = m[2];
      var row = document.createElement('div'); row.className = 'finding';
      if (marker) { var b = document.createElement('span'); b.className = 'badge ' + sevClass(marker); b.textContent = marker; row.appendChild(b); }
      var span = document.createElement('span'); span.innerHTML = inline(rest); row.appendChild(span);
      card.appendChild(row);
    });
    log.appendChild(card);
  }
  // Split a summary into the main body + the Findings BULLET LIST only. The
  // heading + its bullets are removed from main; everything else (incl. a
  // results table that may follow Findings) stays in main so it renders as a
  // proper markdown block — not line-by-line.
  function splitFindings(s) {
    var lines = s.split('\\n'); var hi = -1;
    for (var i = 0; i < lines.length; i++) { var t = lines[i].trim(); if (/^#{1,6}\\s*(findings|bugs|issues)\\b/i.test(t) || /^findings\\s*:/i.test(t)) { hi = i; break; } }
    if (hi < 0) return { main: s, findings: null };
    var j = hi + 1; while (j < lines.length && lines[j].trim() === '') j++;
    var start = j; while (j < lines.length && /^\\s*[-*]\\s+/.test(lines[j])) j++;
    var bullets = lines.slice(start, j);
    var main = lines.slice(0, hi).concat(lines.slice(j)).join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    return { main: main, findings: bullets.length ? bullets.join('\\n') : null };
  }
  // Minimal, safe markdown → HTML (escape first, then a few constructs).
  function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inline(t) { return esc(t).replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>').replace(/\`([^\`]+)\`/g, '<code>$1</code>'); }
  function mdToHtml(md) {
    if (!md) return '';
    var lines = md.split('\\n'); var out = []; var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (/^\\s*\\|.*\\|\\s*$/.test(line)) { // table block
        var rows = []; while (i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = rows.map(function (r) { return r.trim().replace(/^\\||\\|$/g, '').split('|').map(function (c) { return c.trim(); }); });
        var html = '<table>'; var start = 0;
        if (cells[1] && cells[1].every(function (c) { return /^:?-{2,}:?$/.test(c); })) { html += '<tr>' + cells[0].map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr>'; start = 2; }
        for (var r = start; r < cells.length; r++) html += '<tr>' + cells[r].map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
        out.push(html + '</table>'); continue;
      }
      var hm = line.match(/^(#{1,6})\\s+(.*)$/); if (hm) { out.push('<h4>' + inline(hm[2]) + '</h4>'); i++; continue; }
      if (/^\\s*[-*]\\s+/.test(line)) { var items = []; while (i < lines.length && /^\\s*[-*]\\s+/.test(lines[i])) { items.push('<li>' + inline(lines[i].replace(/^\\s*[-*]\\s+/, '')) + '</li>'); i++; } out.push('<ul>' + items.join('') + '</ul>'); continue; }
      if (line.trim() === '') { out.push(''); i++; continue; }
      out.push('<div>' + inline(line) + '</div>'); i++;
    }
    return out.join('');
  }

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
  // ── @account autocomplete ───────────────────────────────────────────────
  var accounts = [];
  var menuEl = document.getElementById('mentions');
  var menuItems = [], menuSel = -1, menuToken = '';
  function menuOpen() { return !menuEl.hidden; }
  function closeMenu() { menuEl.hidden = true; menuItems = []; menuSel = -1; }
  function caretToken() {
    // The @word immediately left of the caret, if any.
    var pos = input.selectionStart, before = input.value.slice(0, pos);
    var m = /@([A-Za-z0-9_-]*)$/.exec(before);
    return m ? m[1] : null;
  }
  function refreshMenu() {
    var tok = caretToken();
    if (tok === null || !accounts.length) { closeMenu(); return; }
    menuToken = tok;
    var low = tok.toLowerCase();
    menuItems = accounts.filter(function(a){ return a.label.toLowerCase().indexOf(low) === 0; });
    if (!menuItems.length) {
      menuEl.innerHTML = '<div class="m-empty">No account matches @' + esc(tok) + ' — add one in Environments</div>';
      menuEl.hidden = false; menuSel = -1; return;
    }
    menuSel = 0;
    menuEl.innerHTML = menuItems.map(function(a, i){
      var sub = [a.role, a.username].filter(Boolean).map(esc).join(' · ');
      return '<div class="m-item' + (i===0?' sel':'') + '" data-i="' + i + '">'
        + '<span class="m-label">@' + esc(a.label) + '</span>'
        + (sub ? '<span class="m-sub">' + sub + '</span>' : '') + '</div>';
    }).join('');
    menuEl.hidden = false;
  }
  function pick(i) {
    var a = menuItems[i]; if (!a) return;
    var pos = input.selectionStart, before = input.value.slice(0, pos), after = input.value.slice(pos);
    var start = before.replace(/@[A-Za-z0-9_-]*$/, '');
    input.value = start + '@' + a.label + ' ' + after;
    var caret = (start + '@' + a.label + ' ').length;
    input.setSelectionRange(caret, caret);
    closeMenu(); input.focus(); syncSend();
  }
  menuEl.addEventListener('mousedown', function(e){
    var row = e.target && e.target.closest ? e.target.closest('.m-item') : null;
    if (row) { e.preventDefault(); pick(Number(row.getAttribute('data-i'))); }
  });
  function moveSel(d) {
    if (!menuItems.length) return;
    menuSel = (menuSel + d + menuItems.length) % menuItems.length;
    var rows = menuEl.querySelectorAll('.m-item');
    rows.forEach(function(r, i){ r.className = 'm-item' + (i===menuSel?' sel':''); });
    var sel = rows[menuSel]; if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  sendBtn.addEventListener('click', submit);
  input.addEventListener('keydown', function(e){
    if (menuOpen() && menuItems.length) {
      if (e.key==='ArrowDown') { e.preventDefault(); moveSel(1); return; }
      if (e.key==='ArrowUp') { e.preventDefault(); moveSel(-1); return; }
      if (e.key==='Enter' || e.key==='Tab') { e.preventDefault(); pick(menuSel); return; }
      if (e.key==='Escape') { e.preventDefault(); closeMenu(); return; }
    }
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener('input', function(){ input.style.height='auto'; input.style.height=Math.min(input.scrollHeight,160)+'px'; syncSend(); refreshMenu(); });
  input.addEventListener('keyup', function(e){ if (e.key==='ArrowLeft'||e.key==='ArrowRight') refreshMenu(); });
  input.addEventListener('blur', function(){ setTimeout(closeMenu, 120); });

  function cmd(id){ return function(){ vscode.postMessage({ type:'command', id:id }); }; }

  // ── Mode + model pickers (Claude-Code "Modes" style popups) ──────────────
  var modeMenu = document.getElementById('mode-menu');
  var modelMenu = document.getElementById('model-menu');
  var models = [], currentModel = '';
  var MODES = [
    { value:'normal',   icon:'⚡', title:'Normal',   desc:'AI drives your app & saves a Playwright spec' },
    { value:'security', icon:'🛡', title:'Security', desc:'Business logic & authz — IDOR / BOLA → security spec' },
    { value:'pentest',  icon:'💀', title:'Pentest',  desc:'Offensive scan of your OWN app → findings report' },
  ];
  function renderPicker(menuEl, header, items, activeVal){
    menuEl.innerHTML = '<div class="p-hdr">'+esc(header)+'</div>' + items.map(function(it){
      return '<div class="p-item'+(it.value===activeVal?' active':'')+'" data-v="'+esc(String(it.value))+'">'
        + (it.icon ? '<span class="p-ic">'+it.icon+'</span>' : '')
        + '<div class="p-body"><div class="p-title">'+esc(it.title)+'</div>'
        + (it.desc ? '<div class="p-desc">'+esc(it.desc)+'</div>' : '')
        + '</div><span class="p-check">✓</span></div>';
    }).join('');
  }
  function closePickers(){ modeMenu.hidden = true; modelMenu.hidden = true; }
  function toggleModeMenu(){
    if (!modeMenu.hidden) { modeMenu.hidden = true; return; }
    closePickers(); renderPicker(modeMenu, 'Mode', MODES, currentModeId || 'normal'); modeMenu.hidden = false;
  }
  function toggleModelMenu(){
    if (!modelMenu.hidden) { modelMenu.hidden = true; return; }
    if (!models.length) return;
    closePickers();
    renderPicker(modelMenu, 'Model', models.map(function(x){ return { value:x.value, title:x.label, desc:x.desc }; }), currentModel);
    modelMenu.hidden = false;
  }
  modeMenu.addEventListener('mousedown', function(e){
    var r = e.target && e.target.closest ? e.target.closest('.p-item') : null; if (!r) return;
    e.preventDefault(); var v = r.getAttribute('data-v'); modeMenu.hidden = true;
    vscode.postMessage({ type:'setMode', modeId: v==='normal' ? null : v });
  });
  modelMenu.addEventListener('mousedown', function(e){
    var r = e.target && e.target.closest ? e.target.closest('.p-item') : null; if (!r) return;
    e.preventDefault(); var v = r.getAttribute('data-v'); modelMenu.hidden = true;
    vscode.postMessage({ type:'setModel', value: v });
  });
  document.getElementById('mode').addEventListener('click', function(e){ e.stopPropagation(); toggleModeMenu(); });
  document.getElementById('model-btn').addEventListener('click', function(e){ e.stopPropagation(); toggleModelMenu(); });
  document.getElementById('browser-toggle').addEventListener('click', cmd('hover.toggleBrowser'));
  document.getElementById('history').addEventListener('click', cmd('hover.sessions.focus'));
  document.getElementById('new').addEventListener('click', cmd('hover.newSession'));
  document.getElementById('appstatus').addEventListener('click', cmd('hover.appStatus'));
  document.addEventListener('mousedown', function(e){
    var t = e.target;
    if (!t || !t.closest || !t.closest('#mode-menu,#mode')) modeMenu.hidden = true;
    if (!t || !t.closest || !t.closest('#model-menu,#model-btn')) modelMenu.hidden = true;
  });
  document.addEventListener('keydown', function(e){ if (e.key==='Escape') closePickers(); });
  // Delegated: the splash buttons live inside the (re-rendered) empty state.
  log.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#startapp')) vscode.postMessage({ type:'command', id:'hover.startApp' });
    else if (e.target.closest('#site')) vscode.postMessage({ type:'command', id:'hover.openSite' });
  });

  var workingEl = null;
  function setWorking(on){
    if (on) { fresh(); if (!workingEl) { workingEl = document.createElement('div'); workingEl.className='working'; workingEl.innerHTML='<span class="pulse"></span><span>Working…</span>'; } log.appendChild(workingEl); scroll(); }
    else if (workingEl && workingEl.parentNode) { workingEl.parentNode.removeChild(workingEl); }
  }

  // A standalone spinner row with a live elapsed timer, for jobs that emit no
  // step events (optimization). setBusy(null) clears it.
  var busyEl = null, busyTimer = null, busyStart = 0;
  function setBusy(text){
    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
    if (busyEl && busyEl.parentNode) busyEl.parentNode.removeChild(busyEl);
    busyEl = null;
    if (!text) return;
    fresh();
    busyEl = document.createElement('div');
    busyEl.className = 'working';
    busyEl.innerHTML = '<span class="pulse"></span><span class="busy-text"></span><span class="busy-time"></span>';
    busyEl.querySelector('.busy-text').textContent = text;
    log.appendChild(busyEl);
    busyStart = Date.now();
    var t = busyEl.querySelector('.busy-time');
    function tick(){ var s = Math.floor((Date.now()-busyStart)/1000); t.textContent = '  ' + Math.floor(s/60) + ':' + ('0'+(s%60)).slice(-2); }
    tick(); busyTimer = setInterval(tick, 1000);
    scroll();
  }
  // "Working…" only shows when running and no group is currently open (the open
  // group's own spinner covers the in-group activity).
  function updateWorking(){ setWorking(running && !curGroup); }

  window.addEventListener('message', function(e){
    var m = e.data; if (!m) return;
    if (m.type==='user'||m.type==='system'||m.type==='assistant') addMessage(m.type, m.text);
    else if (m.type==='narration') addNarration(m.text);
    else if (m.type==='step') addStep(m);
    else if (m.type==='result') addResult(m);
    else if (m.type==='reset') { setBusy(null); if (busyTimer) { clearInterval(busyTimer); busyTimer=null; } workingEl=null; running=false; log.innerHTML=''; cleared=false; curGroup=null; pendingTitle=null; log.appendChild(emptyEl()); input.value=''; syncSend(); }
    else if (m.type==='mode') {
      currentModeId = m.id || null;
      document.getElementById('mode-label').textContent = m.id ? (m.label||m.id) : 'Normal';
      document.getElementById('mode-icon').textContent = m.id==='pentest' ? '💀' : (m.id==='security' ? '🛡' : '⚡');
      document.body.classList.remove('mode-security','mode-pentest');
      if (m.id) document.body.classList.add('mode-'+m.id);
      if (!modeMenu.hidden) renderPicker(modeMenu, 'Mode', MODES, currentModeId || 'normal');
      applyBorder();
    }
    else if (m.type==='models') {
      models = Array.isArray(m.models) ? m.models : [];
      currentModel = m.current || '';
      var found = models.filter(function(x){ return x.value===currentModel; })[0];
      document.getElementById('model-label').textContent = (found && found.label) || currentModel || 'Model';
      if (!modelMenu.hidden) renderPicker(modelMenu, 'Model', models.map(function(x){ return { value:x.value, title:x.label, desc:x.desc }; }), currentModel);
    }
    else if (m.type==='appstatus') {
      var dot=document.getElementById('app-dot'); var lab=document.getElementById('app-label'); var btn=document.getElementById('appstatus');
      if (m.label) { lab.textContent = m.online ? String(m.label) : String(m.label)+' (offline)'; dot.className = m.online ? 'dot' : 'dot offline'; if(btn&&m.title) btn.title = String(m.title); }
      else { lab.textContent='Set target'; dot.className='dot offline'; }
    }
    else if (m.type==='accounts') { accounts = Array.isArray(m.accounts) ? m.accounts : []; }
    else if (m.type==='busy') { setBusy(m.done ? null : (m.text||'Working…')); }
    else if (m.type==='running') { running = !!m.running; if (running) { curGroup = null; pendingTitle = null; } else if (curGroup) { finalizeGroup(); } updateWorking(); applyBorder(); syncSend(); }
    else if (m.type==='config') { speechOn = !!m.speech; silentMode = !!m.silent; var bl=document.getElementById('browser-label'); if(bl) bl.textContent = silentMode ? 'Headless' : 'Normal'; applyBorder(); }
  });
  function emptyEl(){
    var d=document.createElement('div'); d.className='splash';
    d.innerHTML =
      '<div class="splash-hero">' +
        '<img class="splash-mark" src="${iconUri}" alt="Hover" />' +
        '<div class="splash-name">Hover</div>' +
        '<div class="splash-tag">Describe what you want to verify, e.g. <em>"test the login flow"</em>.</div>' +
        '<button class="startapp" id="startapp">▶ Start App</button>' +
      '</div>' +
      '<a class="splash-link" id="site">Visit gethover.dev ↗</a>';
    return d;
  }

  log.appendChild(emptyEl());
  syncSend();
  vscode.postMessage({ type:'ready' });
</script>
</body>
</html>`;
  }
}

export function registerChatView(extensionUri: vscode.Uri): { provider: ChatViewProvider; disposable: vscode.Disposable } {
  const provider = new ChatViewProvider(extensionUri);
  const disposable = vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposable };
}
