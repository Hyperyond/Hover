/**
 * The Hover chat panel — a webview view in the sidebar.
 *
 * This is the in-extension chat the product is built around: type a
 * natural-language instruction ("log in then add a todo"), the engine drives a
 * browser and streams back steps, and the verified flow crystallizes into a
 * Playwright spec. The webview is styled with VSCode theme tokens so it reads
 * as native (per the native-appearance directive; the in-page widget is only a
 * LAYOUT reference). Borrows the widget's layout: a scrollable transcript over
 * a prompt box.
 *
 * NOTE: this is the UI shell + message bus. Wiring `send` to the actual engine
 * (`@hover-dev/core`'s runSession, hosted by the extension or spawned via the
 * CLI) is the next slice — `onSend` is where that lands.
 */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

type Inbound = { type: 'send'; text: string } | { type: 'ready' };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.chat';
  private view?: vscode.WebviewView;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((msg: Inbound) => {
      if (msg.type === 'send') void this.onSend(msg.text);
    });
  }

  /** Append a message to the transcript (role: 'user' | 'assistant' | 'system'). */
  private post(role: string, text: string): void {
    void this.view?.webview.postMessage({ type: 'append', role, text });
  }

  private async onSend(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) return;
    this.post('user', prompt);
    // TODO(engine): hand `prompt` to the engine — launch/attach a debug Chrome,
    // run @hover-dev/core's runSession with cwd = workspace root, stream step
    // events back via this.post('assistant', …), then offer Save-as-spec. For
    // now the shell acknowledges so the chat is visibly live.
    this.post(
      'system',
      'Engine not wired yet — this is the chat shell. Next slice: run the Hover engine here (drive Chrome, stream steps, crystallize a spec).',
    );
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #log { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .msg { padding: 7px 10px; border-radius: 6px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; max-width: 100%; }
  .user { align-self: flex-end; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .assistant { align-self: flex-start; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
  .system { align-self: stretch; font-size: 0.9em; opacity: 0.75; font-style: italic; }
  .empty { margin: auto; opacity: 0.6; text-align: center; padding: 0 16px; }
  #bar { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border)); }
  #input {
    flex: 1; resize: none; min-height: 34px; max-height: 140px;
    font-family: inherit; font-size: inherit;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder, #0000)); border-radius: 4px; padding: 7px 8px;
  }
  #send {
    align-self: flex-end; border: none; border-radius: 4px; padding: 0 12px; height: 34px; cursor: pointer;
    color: var(--vscode-button-foreground); background: var(--vscode-button-background);
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <div id="log"><div class="empty">Tell Hover what to do — e.g. <em>"log in, then add a todo"</em>. It drives a real browser and saves the verified flow as a Playwright spec.</div></div>
  <div id="bar">
    <textarea id="input" rows="1" placeholder="Describe a flow to test…"></textarea>
    <button id="send">Send</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  let cleared = false;

  function append(role, text) {
    if (!cleared) { log.innerHTML = ''; cleared = true; }
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }
  function submit() {
    const text = input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: 'send', text });
    input.value = '';
    input.style.height = 'auto';
  }
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.type === 'append') append(m.role, m.text);
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

export function registerChatView(): vscode.Disposable {
  return vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, new ChatViewProvider(), {
    webviewOptions: { retainContextWhenHidden: true },
  });
}
