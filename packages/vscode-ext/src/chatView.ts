/**
 * The Hover chat panel — a webview view in the sidebar.
 *
 * Visual design faithfully mirrors the marketed in-page widget (the official
 * promo UI): the dark mint palette, the "Default ▾ click to switch" mode bar,
 * the "claude ▾" agent pill + book/star icons + "● ready" status, green
 * checkmark step rows, the PASS result card with "Save as ▾", and the prompt
 * box with a green send button. Palette + structure lifted from
 * `@hover-dev/widget-bootstrap`'s style.css / template.html so the extension
 * reads as the same product as the widget.
 *
 * This is the UI shell + message bus. Wiring `send` to the engine
 * (`@hover-dev/core`'s runSession, hosted by the extension or spawned via the
 * CLI) is the next slice — `onSend` is where that lands; the step / result
 * renderers below already match how the engine will stream.
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

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: Inbound) => {
      if (msg.type === 'send') void this.onSend(msg.text);
      else if (msg.type === 'command' && typeof msg.id === 'string') {
        void vscode.commands.executeCommand(msg.id);
      }
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  /** Recolor the chat header to the active mode (null = Default/mint). */
  updateMode(id: string | null, label: string | null): void {
    this.post({ type: 'mode', id, label: label ?? 'Default' });
  }

  /** Reflect service connection in the header status line. */
  updateStatus(text: string): void {
    this.post({ type: 'status', text });
  }

  private async onSend(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) return;
    this.post({ type: 'user', text: prompt });
    // TODO(engine): hand `prompt` to the engine — launch/attach a debug Chrome,
    // run @hover-dev/core's runSession with cwd = workspace root, stream step
    // events as { type:'step', label, status } and finish with
    // { type:'result', verdict, summary, steps }, then offer Save-as-spec.
    this.post({
      type: 'system',
      text: 'Engine not wired yet — this is the chat shell. Next: run the Hover engine here (drive Chrome, stream these steps, crystallize a spec).',
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [`default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
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
    --radius: 12px;
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

  .modebar {
    display: flex; align-items: center; gap: 7px; width: 100%;
    padding: 9px 12px; background: var(--bg); border: none; border-bottom: 1px solid var(--line);
    color: var(--text); cursor: pointer; font: inherit; text-align: left;
  }
  .modebar:hover { background: var(--bg-2); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .modebar .caret { color: var(--text-dim); }
  .modebar .hint { margin-left: auto; color: var(--text-dim); font-size: 12px; }

  header { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--line); }
  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 9px; border: 1px solid var(--line); border-radius: 7px;
    background: var(--bg-2); color: var(--text); cursor: pointer; font: inherit;
  }
  .pill:hover { border-color: var(--accent); }
  .pill .caret { color: var(--text-dim); }
  .iconbtn { display: inline-flex; padding: 4px; border: none; background: none; color: var(--text-mute); cursor: pointer; border-radius: 6px; }
  .iconbtn:hover { color: var(--text); background: var(--bg-2); }
  .status { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--text-mute); font-size: 12px; }

  #log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .empty { margin: auto; text-align: center; color: var(--text-dim); padding: 0 20px; line-height: 1.5; }
  .empty em { color: var(--text-mute); font-style: normal; }

  .msg { padding: 8px 11px; border-radius: 10px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; max-width: 88%; background: var(--accent); color: var(--accent-ink); font-weight: 500; }
  .msg.system { align-self: stretch; font-size: 12px; color: var(--text-mute); background: var(--bg-2); border: 1px solid var(--line); }

  .step { display: flex; align-items: center; gap: 9px; padding: 9px 11px; background: var(--bg-2); border: 1px solid var(--line); border-radius: 9px; }
  .step .check { color: var(--accent); flex: none; font-weight: 700; }
  .step .running { color: var(--text-dim); }
  .step .label { flex: 1; color: var(--text); }
  .step .caret { color: var(--text-dim); }

  .result { border: 1px solid var(--accent); border-radius: var(--radius); background: var(--accent-dim); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .result .head { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--accent); }
  .result .body { color: var(--text); line-height: 1.45; }
  .result code { background: var(--bg-3); padding: 1px 5px; border-radius: 4px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .saveas { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border: 1px solid var(--accent); border-radius: 7px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
  .saveas:hover { background: var(--accent); color: var(--accent-ink); }

  #bar { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--bg); }
  #input {
    flex: 1; resize: none; min-height: 38px; max-height: 150px; padding: 9px 11px;
    color: var(--text); background: var(--bg-3); border: 1px solid var(--line); border-radius: 9px;
    font: inherit;
  }
  #input::placeholder { color: var(--text-dim); }
  #input:focus { outline: none; border-color: var(--accent); }
  #send {
    flex: none; width: 38px; height: 38px; border: none; border-radius: 9px; cursor: pointer;
    background: var(--accent); color: var(--accent-ink); display: inline-flex; align-items: center; justify-content: center;
  }
  #send:hover { filter: brightness(1.08); }
</style>
</head>
<body>
  <button class="modebar" id="modebar" type="button" title="Switch mode (Testing / Security / Pentest)">
    <span class="dot"></span><span id="mode-label">Default</span><span class="caret">▾</span>
    <span class="hint">click to switch</span>
  </button>
  <header>
    <button class="pill" id="agent" type="button" title="Current coding agent">
      <span id="agent-label">claude</span><span class="caret">▾</span>
    </button>
    <button class="iconbtn" id="sessions" type="button" title="Sessions">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a1 1 0 0 1 1 1v7H3a1 1 0 0 1-1-1V4Z"/><path d="M9 5a1 1 0 0 1 1-1h4v8H10a1 1 0 0 0-1 1V5Z"/></svg>
    </button>
    <button class="iconbtn" id="star" type="button" title="Star Hover on GitHub">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2l1.85 3.75 4.15.6-3 2.92.71 4.13L8 11.65l-3.71 1.95.71-4.13-3-2.92 4.15-.6L8 2.2Z"/></svg>
    </button>
    <span class="status"><span class="dot"></span><span id="status-label">ready</span></span>
  </header>
  <div id="log"><div class="empty">Tell Hover what to do — e.g. <em>"log in, then add a todo"</em>.<br/>It drives a real browser and saves the verified flow as a Playwright spec.</div></div>
  <div id="bar">
    <textarea id="input" rows="1" placeholder="Type a flow to test…"></textarea>
    <button id="send" type="button" title="Send">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
    </button>
  </div>
<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var log = document.getElementById('log');
  var input = document.getElementById('input');
  var cleared = false;

  function fresh() { if (!cleared) { log.innerHTML = ''; cleared = true; } }
  function scroll() { log.scrollTop = log.scrollHeight; }

  function addMessage(role, text) {
    fresh();
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    log.appendChild(el); scroll();
  }
  function addStep(label, status) {
    fresh();
    var el = document.createElement('div');
    el.className = 'step';
    var mark = document.createElement('span');
    if (status === 'running') { mark.className = 'running'; mark.textContent = '○'; }
    else { mark.className = 'check'; mark.textContent = '✓'; }
    var lab = document.createElement('span'); lab.className = 'label'; lab.textContent = label;
    var car = document.createElement('span'); car.className = 'caret'; car.textContent = '▾';
    el.appendChild(mark); el.appendChild(lab); el.appendChild(car);
    log.appendChild(el); scroll();
  }
  function addResult(verdict, summary, steps) {
    fresh();
    var card = document.createElement('div'); card.className = 'result';
    var head = document.createElement('div'); head.className = 'head';
    head.textContent = '✓ ' + (verdict || 'PASS') + (steps ? ' — done in ' + steps + ' steps' : '');
    var body = document.createElement('div'); body.className = 'body'; body.textContent = summary || '';
    var save = document.createElement('button'); save.className = 'saveas'; save.textContent = '\\uD83D\\uDCBE Save as ▾';
    save.addEventListener('click', function () { vscode.postMessage({ type: 'command', id: 'hover.refreshSpecs' }); });
    card.appendChild(head); card.appendChild(body); card.appendChild(save);
    log.appendChild(card); scroll();
  }

  function submit() {
    var text = input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text: text });
    input.value = ''; input.style.height = 'auto';
  }
  document.getElementById('send').addEventListener('click', submit);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px'; });

  document.getElementById('modebar').addEventListener('click', function () { vscode.postMessage({ type: 'command', id: 'hover.switchMode' }); });
  document.getElementById('sessions').addEventListener('click', function () { vscode.postMessage({ type: 'command', id: 'hover.specs.focus' }); });

  window.addEventListener('message', function (e) {
    var m = e.data; if (!m) return;
    if (m.type === 'user' || m.type === 'system' || m.type === 'assistant') addMessage(m.type, m.text);
    else if (m.type === 'step') addStep(m.label, m.status);
    else if (m.type === 'result') addResult(m.verdict, m.summary, m.steps);
    else if (m.type === 'mode') {
      document.getElementById('mode-label').textContent = m.label || 'Default';
      document.body.className = m.id ? 'mode-' + m.id : '';
    }
    else if (m.type === 'status') { document.getElementById('status-label').textContent = m.text || 'ready'; }
  });
  vscode.postMessage({ type: 'ready' });
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
