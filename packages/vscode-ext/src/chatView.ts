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
  | { type: 'setEffort'; value: string }
  | { type: 'askUserAnswer'; askId: string; value: string | null }
  | { type: 'switchSession'; id: string }
  | { type: 'saveRun'; name: string; mode: string | null }
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
  effortHandler?: (value: string) => void;
  /** Set by the extension: the user answered an in-chat ask_user card (value
   *  null = dismissed). */
  askAnswerHandler?: (askId: string, value: string | null) => void;
  /** Set by the extension: the user picked a conversation in the top-bar switcher. */
  sessionSwitchHandler?: (id: string) => void;
  /** Set by the extension: the user confirmed the after-run save prompt with a
   *  filename. `mode` (null = frontend, 'api-test', 'pentest') routes the writer:
   *  api-test → request-based spec, pentest → findings report, else → normal spec. */
  saveRunHandler?: (name: string, mode: string | null) => void;

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
      else if (msg.type === 'setEffort' && typeof msg.value === 'string') this.effortHandler?.(msg.value);
      else if (msg.type === 'askUserAnswer' && typeof msg.askId === 'string') this.askAnswerHandler?.(msg.askId, msg.value ?? null);
      else if (msg.type === 'switchSession' && typeof msg.id === 'string') this.sessionSwitchHandler?.(msg.id);
      else if (msg.type === 'saveRun' && typeof msg.name === 'string') this.saveRunHandler?.(msg.name, msg.mode ?? null);
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

  /** Push the conversation list + active id to the top-bar switcher. */
  setSessions(list: { id: string; name: string; running?: boolean }[], activeId: string): void {
    this.post({ type: 'sessions', list, activeId });
  }
  /** Re-render the chat with a switched conversation's transcript. */
  loadSession(transcript: { kind: string; [k: string]: unknown }[]): void {
    this.post({ type: 'loadSession', transcript });
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
  /** Push the model picker's list for the current agent + the active model,
   *  plus the reasoning-effort options for that model (empty = no effort
   *  control → the picker hides the effort section). */
  updateModels(
    models: { value: string; label: string; desc?: string; disabled?: boolean }[],
    current: string,
    effort?: { options: string[]; current: string },
    locked?: boolean,
  ): void {
    this.post({ type: 'models', models, current, effort, locked });
  }

  // Streamed run rendering (called by the extension as engine events arrive).
  pushStep(step: { label: string; tool?: string; detail?: string; cost?: number; tokens?: number }): void {
    this.post({ type: 'step', ...step });
  }
  /** AI narration → the next step group's title. */
  pushNarration(text: string): void {
    this.post({ type: 'narration', text });
  }
  /** Running token total (from usage events) → live group counter. */
  pushUsage(tokens: number): void {
    this.post({ type: 'usage', tokens });
  }
  pushAssistant(text: string): void {
    this.post({ type: 'assistant', text });
  }
  pushSystem(text: string): void {
    this.post({ type: 'system', text });
  }
  /** Render an in-chat prompt card (question + options, plus an always-present
   *  "Other" free-text row unless `other:false` — permission cards omit it).
   *  The webview posts back `askUserAnswer` → askAnswerHandler. */
  askUser(req: { askId: string; question: string; options: { label: string; description?: string }[]; other?: boolean }): void {
    this.post({ type: 'askUser', ...req });
  }
  pushResult(verdict: string, summary: string, steps?: number, cost?: number, tokens?: number, findings?: unknown[], mode?: string | null): void {
    this.post({ type: 'result', verdict, summary, steps, cost, tokens, findings, mode: mode ?? null });
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
  body.mode-api-test { --accent: #fb923c; --accent-dim: rgba(251,146,60,0.16); --accent-ink: #2a1605; }
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
  /* API-testing mode running → orange border; pentest → red. Pulsing glow. */
  body.border-api-test::after, body.border-pentest::after {
    content: ''; position: fixed; inset: 0; z-index: 9999; pointer-events: none; padding: 2.5px;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: hov-bpulse 1.6s ease-in-out infinite;
  }
  body.border-api-test::after { background: #fb923c; }
  body.border-pentest::after { background: #f87171; }
  @keyframes hov-bpulse { 0%,100% { opacity: .4; } 50% { opacity: 1; } }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }

  header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); position: relative; }
  #session { max-width: 230px; }
  #session #session-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #session-run { color: #3fb950; font-size: 9px; margin-right: 3px; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
  .popup.sess { top: calc(100% - 2px); bottom: auto; left: 10px; max-height: 60vh; overflow: auto; }
  .popup.sess .sess-tabs { display: flex; gap: 2px; margin: 2px 6px 6px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 3px; }
  .popup.sess .sess-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 5px; border-radius: 5px; color: var(--text-dim); cursor: pointer; font-size: 12px; user-select: none; }
  .popup.sess .sess-tab.active { color: var(--text); background: var(--bg-2); }
  .popup.sess .sess-tab.locked { cursor: default; }
  .popup.sess .sess-tab svg { opacity: .8; }
  .popup.sess .sess-search { margin: 0 6px 6px; position: relative; }
  .popup.sess .sess-search input { width: 100%; padding: 6px 9px 6px 26px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--text); font: inherit; font-size: 12px; }
  .popup.sess .sess-search input::placeholder { color: var(--text-dim); }
  .popup.sess .sess-search input:focus { outline: none; border-color: #3a3a3d; }
  .popup.sess .sess-search svg { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-dim); }
  .popup.sess .sess-cloud { padding: 18px 12px; text-align: center; color: var(--text-dim); font-size: 11.5px; line-height: 1.5; }
  .popup.sess .p-item .p-run { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); align-self: center; animation: pulse 1.4s ease-in-out infinite; }
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

  #log { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 768px; margin: 0 auto; }
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
  .msg.system { align-self: stretch; font-size: 12px; color: var(--text-dim); background: none; border: none; padding: 2px 2px; }
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
  /* Linear run stream (Claude-Code style). One run = one continuous left "thread"
     rail; every line (an AI thought or a browser op) is a node with a dot on the
     rail and its content just to the right. The rail line is each node's
     full-height left column, so stacked nodes form one unbroken line. */
  .run { margin: 5px 0 9px; }
  .node { display: flex; gap: 9px; align-items: stretch; }
  .node-rail { position: relative; width: 11px; flex: none; }
  .node-rail::before { content: ''; position: absolute; left: 5px; top: 0; bottom: 0; width: 1.5px; background: var(--line); }
  .node:first-child .node-rail::before { top: 8px; }
  .node:last-child .node-rail::before { bottom: auto; height: 9px; }
  /* think node = a bold filled accent dot with an accent halo (distinct from
     ops); op node = a small hollow dot that fills accent while live. Dots are
     vertically centered on their first text line. */
  .node-rail::after { content: ''; position: absolute; left: 1px; top: 7px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--accent-dim); }
  .node.think.active .node-rail::after { animation: hov-halo 1.5s ease-in-out infinite; }
  @keyframes hov-halo { 0%,100% { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--accent-dim); } 50% { box-shadow: 0 0 0 2px var(--bg), 0 0 0 6px var(--accent-dim); } }
  .node.op .node-rail::after { left: 3px; top: 6px; width: 5px; height: 5px; background: var(--bg); border: 1.5px solid var(--text-dim); box-shadow: 0 0 0 2px var(--bg); }
  .node.op.live .node-rail::after { background: var(--accent); border-color: var(--accent); }
  .node.op.answered .node-rail::after { background: var(--accent); border-color: var(--accent); }
  .node.op.answered .node-body { color: var(--accent); }
  .node.error .node-rail::after { background: var(--err); border-color: var(--err); }
  .node-body { flex: 1; min-width: 0; padding: 1.5px 8px 1.5px 0; word-break: break-word; overflow-wrap: anywhere; }
  .node.think .node-body { color: var(--text); font-size: 13px; line-height: 1.5; }
  .node.think.active .node-body { color: var(--accent); }
  .node.op .node-body { color: var(--text-mute); font-size: 12px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); line-height: 1.4; }
  .node.op.live .node-body { color: var(--text); }
  .node.error .node-body { color: var(--err); }
  /* Typing caret: a blinking block cursor trailing the text while it types. */
  .node-body.typing::after, .md.typing::after { content: '▌'; margin-left: 1px; color: var(--accent); animation: hov-blink 1s steps(1) infinite; }
  @keyframes hov-blink { 50% { opacity: 0; } }
  .node-meta { float: right; margin-left: 10px; font-size: 10.5px; color: var(--text-dim); font-variant-numeric: tabular-nums; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .node-meta .gr-cost { color: var(--accent); }
  /* Monochrome copy button (Done summary + each finding); ✓ on success. */
  .copybtn { flex: none; background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 2px; display: inline-flex; align-items: center; border-radius: 4px; }
  .copybtn:hover { color: var(--text); background: var(--line); }
  .copybtn.copied { color: var(--accent); }
  .copybtn svg { width: 14px; height: 14px; }
  /* Result: a plain conversational block (no card border) — ✓ + verdict, the
     summary prose, inline findings, then a dim meta footer. */
  .result { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px 6px; }
  .result .rhead { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text); font-size: 13.5px; }
  .result .rhead .rcheck { color: var(--accent); font-weight: 700; }
  .result .rhead .copybtn { margin-left: auto; }
  .result.err .rhead { color: var(--err); } .result.err .rhead .rcheck { color: var(--err); }
  .result .rfoot { font-size: 11px; color: var(--text-dim); font-variant-numeric: tabular-nums; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .result .finding { display: flex; gap: 8px; align-items: flex-start; line-height: 1.45; font-size: 12.5px; }
  .result .finding .copybtn { margin-left: auto; align-self: flex-start; }
  .md { line-height: 1.5; }
  .md h4 { font-size: 1em; margin: 8px 0 4px; }
  .md div { margin: 2px 0; }
  .md code { background: var(--bg-3); padding: 1px 4px; border-radius: 4px; font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .md table { border-collapse: collapse; margin: 6px 0; font-size: 12px; }
  .md th, .md td { border: 1px solid var(--line); padding: 3px 7px; text-align: left; }
  .md ul { margin: 4px 0; padding-left: 18px; }
  .md hr { border: none; border-top: 1px solid var(--line); margin: 9px 0; }
  .saveas { align-self: flex-start; padding: 6px 11px; border: 1px solid var(--accent); border-radius: 7px; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-weight: 600; }
  .saveas:hover { background: var(--accent); color: var(--accent-ink); }
  .ask { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 12px; background: var(--bg-2); padding: 13px 14px; display: flex; flex-direction: column; gap: 10px; }
  .ask.resolved { border: 1px solid var(--line); border-left: 2px solid var(--accent); background: var(--bg-2); padding: 7px 11px; gap: 2px; }
  .ask.resolved .ask-r-q { font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ask.resolved .ask-r-a { font-size: 12.5px; color: var(--accent); font-weight: 600; display: flex; align-items: center; gap: 5px; }
  .ask .ask-q { font-weight: 600; color: var(--text); font-size: 13px; line-height: 1.4; }
  .ask .ask-opts { display: flex; flex-direction: column; gap: 6px; }
  .ask .ask-opt { text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 8px 11px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); cursor: pointer; font: inherit; }
  .ask .ask-opt:hover { border-color: var(--accent); }
  .ask .ask-opt small { color: var(--text-dim); font-size: 11px; }
  .ask .ask-other { color: var(--text-dim); }
  .ask .ask-other-row { display: flex; gap: 7px; align-items: center; }
  .ask .ask-other-row input { flex: 1; min-width: 0; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; }
  .ask .ask-other-row input:focus { outline: none; border-color: var(--accent); }
  .ask .ask-pencil { flex: none; display: inline-flex; align-items: center; color: var(--text-dim); }
  .ask .ask-pencil svg { width: 14px; height: 14px; }
  .ask .ask-go { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--bg-2); color: var(--text); cursor: pointer; }
  .ask .ask-go:hover { border-color: var(--accent); color: var(--accent); }
  .ask .ask-go svg { width: 16px; height: 16px; }
  .ask .ask-send { padding: 7px 12px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: var(--accent-ink); cursor: pointer; font: inherit; font-weight: 600; }
  .findings { border: 1px solid var(--line); border-left: 3px solid var(--warn); border-radius: 12px; background: var(--bg-2); padding: 13px 14px; display: flex; flex-direction: column; gap: 9px; }
  .findings .fhead { display: flex; align-items: center; gap: 7px; font-weight: 600; color: var(--warn); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .finding { display: flex; gap: 8px; align-items: flex-start; line-height: 1.45; }
  .badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; flex: none; text-transform: uppercase; letter-spacing: .03em; }
  .badge.bug { background: #f87171; color: #240808; }
  .badge.minor { background: var(--warn); color: #241805; }
  .badge.info { background: var(--line); color: var(--text); }

  /* Claude-Code-style input box: one rounded container, toolbar row inside. */
  /* Bottom ask "popup": while the agent is waiting on a human decision, its
     question docks just above the composer — pinned, never scrolled away with
     the transcript. On answer it collapses into the log as a record. */
  #ask-dock { width: 100%; max-width: 768px; margin: 0 auto; padding: 10px 12px 0; }
  /* Docked popup frame matches the input box exactly (same bg / 1px border /
     12px radius / focus highlight) so it sits right where the input was — no
     accent left-stripe here, unlike the collapsed in-log ask records. */
  #ask-dock .ask { background: var(--bg-3); border: 1px solid var(--line); box-shadow: 0 -2px 18px rgba(0,0,0,.35); max-height: 46vh; overflow-y: auto; animation: askpop .16s ease-out; }
  #ask-dock .ask:focus-within { border-color: var(--accent); }
  @keyframes askpop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  #composer { padding: 10px 12px 12px; position: relative; width: 100%; max-width: 768px; margin: 0 auto; }
  /* The ask popup is mutually exclusive with the input: while a question (or the
     save prompt) is up it takes the composer's place — same width, input hidden.
     Pinned to the bottom with the composer's exact padding so the popup's bottom
     edge sits exactly where the input box's was; it grows upward as it gets taller. */
  /* While an ask/save popup is up, hide the input and let the dock take its
     place. The dock stays IN FLOW (same max-width / centering as the composer,
     so identical width) and is the last flex child, so it sits at the bottom;
     matching the composer's bottom padding aligns its bottom edge to the input's. */
  body.ask-open #composer { display: none; }
  body.ask-open #ask-dock { padding-bottom: 12px; }
  .ask-warn { font-size: 12px; color: var(--warn); line-height: 1.4; }
  .ask-btns { display: flex; justify-content: flex-end; gap: 8px; }
  .ask-discard { padding: 7px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--text-mute); cursor: pointer; font: inherit; }
  .ask-discard:hover { color: var(--text); border-color: var(--text-dim); }
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
  #toolbar { display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--line); margin: 4px -10px 0; padding: 7px 10px 0; }
  #toolbar .left { display: flex; align-items: center; gap: 6px; }
  #toolbar .right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  /* Borderless toolbar buttons (Claude-Code "auto mode" style): icon + text,
     no chrome, subtle hover. */
  .barebtn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border: none; background: none; color: var(--text-mute); cursor: pointer; font: inherit; font-size: 12px; border-radius: 7px; }
  .barebtn:hover { color: var(--text); background: var(--bg-2); }
  /* Model button when locked (Local LLM — model lives in Settings): shown but not interactive. */
  #model-btn.locked { opacity: .6; cursor: default; }
  #model-btn.locked:hover { background: none; color: var(--text-mute); }
  .barebtn .caret { color: var(--text-dim); font-size: 10px; }
  .barebtn svg { opacity: .9; }
  #mode-icon { display: inline-flex; align-items: center; }
  .p-ic svg { display: block; margin: 1px auto 0; }
  /* While a run is active, the target can't change mid-flight — lock the
     browser / model / mode pickers (send becomes the stop control). */
  body.running #browser-toggle, body.running #model-btn, body.running #mode { pointer-events: none; opacity: .4; }
  /* Mode button tints to the active mode. */
  body.mode-api-test #mode { color: var(--warn); }
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
  /* "Experimental" / "Soon" pill next to a picker title. */
  .p-tag { font-size: 9px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text-dim); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; margin-left: 6px; vertical-align: middle; }
  .p-item.disabled { opacity: .45; cursor: default; }
  .p-item.disabled:hover { background: none; }
  /* Reasoning-effort chips below the model list. */
  .eff-hdr { margin-top: 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  .eff-row { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 8px 6px; }
  .eff-chip { padding: 4px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--text-mute); cursor: pointer; font: inherit; font-size: 11.5px; text-transform: capitalize; }
  .eff-chip:hover { border-color: var(--accent); color: var(--text); }
  .eff-chip.active { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
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
    <button class="iconbtn" id="new" type="button" title="New session">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
    </button>
    <button class="barebtn" id="session" type="button" title="Switch conversation"><span id="session-run" hidden title="A run is active in another conversation">●</span><span id="session-label">New session</span><span class="caret">▾</span></button>
    <span class="spacer"></span>
    <button class="appstatus" id="appstatus" type="button" title="App URL — click to set / start">
      <span class="dot offline" id="app-dot"></span><span id="app-label">detecting…</span>
    </button>
    <div id="session-menu" class="popup sess" hidden></div>
  </header>

  <div id="log"></div>

  <div id="ask-dock" hidden></div>

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
          <button class="barebtn" id="model-btn" type="button" title="Model — click to switch"><span id="model-label">Sonnet 4.6</span></button>
        </div>
        <div class="right">
          <button class="barebtn" id="mode" type="button" title="Switch mode (Frontend / Security / Pentest)"><span class="bolt" id="mode-icon"></span><span id="mode-label">Frontend</span></button>
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
  var askDock = document.getElementById('ask-dock');
  var input = document.getElementById('input');
  // Ask/save popups are mutually exclusive with the composer: toggling this
  // hides the input so the popup takes its place (same width).
  function setAskActive(on) { document.body.classList.toggle('ask-open', !!on); }
  // Monochrome copy button: copies getText() to the clipboard; the icon flips to
  // a checkmark on success, then reverts.
  var ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>';
  function fallbackCopy(txt) { try { var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) {} }
  function makeCopyBtn(getText) {
    var b = document.createElement('button'); b.className = 'copybtn'; b.type = 'button'; b.title = 'Copy'; b.innerHTML = COPY_SVG;
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var txt = (getText() || '').trim();
      function ok() { b.innerHTML = CHECK_SVG; b.classList.add('copied'); b.title = 'Copied'; setTimeout(function () { b.innerHTML = COPY_SVG; b.classList.remove('copied'); b.title = 'Copy'; }, 1500); }
      try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(ok, function () { fallbackCopy(txt); ok(); }); return; } } catch (e2) {}
      fallbackCopy(txt); ok();
    });
    return b;
  }
  var sendBtn = document.getElementById('send');
  var cleared = false;

  var speechOn = false, silentMode = false, currentModeId = null, replaying = false;
  function speak(text) { if (!speechOn || !text || replaying) return; try { if (window.speechSynthesis) { window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(text).slice(0, 300))); } } catch (e) {} }
  // Running-border: only the silent (headless) Chrome ring. The api-test /
  // pentest mode tint was removed — the mode is already shown by the mode pill.
  function applyBorder() {
    var b = document.body;
    b.classList.remove('silent-running', 'border-api-test', 'border-pentest');
    if (!running) return;
    if (silentMode) b.classList.add('silent-running');
  }
  function fresh() { if (!cleared) { log.innerHTML = ''; cleared = true; } }
  function scroll() { if (typeof workingEl !== 'undefined' && workingEl && running && workingEl.parentNode) log.appendChild(workingEl); log.scrollTop = log.scrollHeight; }
  function addMessage(role, text) { fresh(); var el = document.createElement('div'); el.className = 'msg ' + role; el.textContent = text; log.appendChild(el); if (role === 'assistant') speak(text); scroll(); }
  // ── Linear run stream (Claude-Code style): each AI thought opens a "thinking"
  //    section with a left thread rail; the browser ops it triggers hang off the
  //    rail as nodes. Flat — no folding, no boxes. A new narration ends the
  //    current section and opens the next. ──
  var curRun = null;      // the current run's thread container (.run element)
  var curThought = null;  // active thinking node: { node, meta, start, tokStart, tokEnd }
  var pendingRec = null;  // a thought record held until its first op arrives (or discarded)
  var liveRec = null;     // the thought record being timed, by REAL event-arrival times
  var lastTokens = 0;     // latest cumulative token count seen (stamped at arrival)

  // Browser-op → one human line. live=true gives the present-progressive form
  // ("Filling employer…") for the visible running line; live=false gives the
  // past-tense form ("Filled employer → Acme Corp") for the collapsed history.
  var OPVERB = {
    click_control: ['Clicking', 'Clicked'], browser_click: ['Clicking', 'Clicked'],
    fill_control: ['Filling', 'Filled'], browser_type: ['Typing into', 'Typed into'],
    select_control: ['Selecting', 'Selected'], browser_select_option: ['Selecting', 'Selected'],
    check_control: ['Checking', 'Checked'],
    browser_navigate: ['Navigating to', 'Navigated to'], browser_navigate_back: ['Going back', 'Went back'],
    browser_snapshot: ['Looking at the page', 'Looked at the page'],
    browser_take_screenshot: ['Capturing a screenshot', 'Captured a screenshot'],
    browser_press_key: ['Pressing', 'Pressed'], browser_hover: ['Hovering', 'Hovered'],
    browser_drag: ['Dragging', 'Dragged'], browser_wait_for: ['Waiting', 'Waited'],
    browser_tabs: ['Switching tabs', 'Switched tabs'], browser_evaluate: ['Running a script', 'Ran a script'],
    browser_fill_form: ['Filling the form', 'Filled the form']
  };
  var FILLISH = { fill_control: 1, select_control: 1, browser_select_option: 1, browser_type: 1 };
  var BARE = { browser_snapshot: 1, browser_navigate_back: 1, browser_take_screenshot: 1, browser_fill_form: 1, browser_drag: 1, browser_wait_for: 1, browser_tabs: 1, browser_evaluate: 1 };
  // Low-signal ops kept OUT of the visible stream (the full record stays in the
  // .hover sidecar): pure observation (snapshot/screenshot), waits, and
  // navigation-only key presses (scroll / Escape). Meaningful keys (Enter,
  // Meta+a, Tab) still render.
  var QUIET_TOOLS = { browser_snapshot: 1, browser_take_screenshot: 1, browser_wait_for: 1 };
  var NAV_KEYS = { pagedown: 1, pageup: 1, end: 1, home: 1, escape: 1 };
  function isQuietStep(m) {
    var t = (m.tool || '').replace(/^mcp__.*?__/, '');
    if (QUIET_TOOLS[t]) return true;
    if (t === 'browser_press_key') {
      try { var k = String((JSON.parse(m.detail || '{}').key) || '').toLowerCase(); if (NAV_KEYS[k] || k.indexOf('arrow') === 0) return true; } catch (e) {}
    }
    return false;
  }
  function describeOp(tool, detailStr, live) {
    var t = (tool || '').replace(/^mcp__.*?__/, '');
    var d = {}; try { d = detailStr ? JSON.parse(detailStr) : {}; } catch (e) { d = {}; }
    var name = d.name || d.text || d.element || '';
    var val = (d.value !== undefined && d.value !== null && d.value !== '') ? String(d.value) : '';
    var pair = OPVERB[t];
    if (!pair) { var h = t.split('_').join(' '); h = h.charAt(0).toUpperCase() + h.slice(1); return h + (live ? '…' : ''); }
    var verb = pair[live ? 0 : 1];
    if (t === 'browser_navigate') return verb + (d.url ? ' ' + d.url : '') + (live ? '…' : '');
    if (t === 'browser_press_key') return verb + (d.key ? ' ' + d.key : '') + (live ? '…' : '');
    if (BARE[t]) return verb + (live ? '…' : '');
    if (FILLISH[t]) { var lbl = name ? ' ' + name : ' a field'; return live ? verb + lbl + '…' : verb + lbl + (val ? ' → ' + val : ''); }
    var q = name ? ' "' + name + '"' : ''; // click / hover / check
    return verb + q + (live ? '…' : '');
  }
  // Type text into an element char-by-char with a trailing blinking caret, then
  // call done(). Instant during replay so history doesn't re-animate. Reveals a
  // few chars per tick so longer lines don't crawl.
  function typeInto(el, text, done) {
    if (el._iv) { clearInterval(el._iv); el._iv = null; }
    if (replaying || !text) { el.textContent = text || ''; el.classList.remove('typing'); if (done) done(); return; }
    el.textContent = ''; el.classList.add('typing'); var i = 0;
    var step = text.length > 48 ? 2 : 1; // keep long lines from crawling
    el._iv = setInterval(function () {
      i = Math.min(i + step, text.length);
      el.textContent = text.slice(0, i);
      scroll();
      if (i >= text.length) { clearInterval(el._iv); el._iv = null; el.classList.remove('typing'); if (done) done(); }
    }, 18);
  }
  // Compact duration: sub-minute keeps one decimal ("48.3s"); a minute or more
  // rolls into "1m 6s" so long runs don't read as an unbounded second count.
  function fmtDur(ms) {
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    var mn = Math.floor(s / 60), rs = Math.round(s - mn * 60);
    if (rs === 60) { mn++; rs = 0; }
    return mn + 'm' + (rs ? ' ' + rs + 's' : '');
  }
  // Full token count with thousands separators (no k/M abbreviation).
  function fmtTokens(n) { return Math.round(n).toLocaleString() + ' tok'; }
  // Meta = the thought RECORD's real elapsed time + token delta. The record is
  // stamped at event-ARRIVAL time (not render time), so the queue's render lag
  // never collapses durations to 0.
  function setThoughtMeta(t) {
    if (!t || !t.meta || !t.rec) return;
    var r = t.rec; var end = (r.end != null) ? r.end : Date.now();
    var parts = [fmtDur(end - r.start)];
    if (typeof r.tokEnd === 'number' && typeof r.tokStart === 'number') {
      var d = r.tokEnd - r.tokStart;
      if (d > 0) parts.push('<span class="gr-cost">' + fmtTokens(d) + '</span>');
    }
    t.meta.innerHTML = parts.join(' · ');
  }
  // Close the active thought record at REAL arrival time + freeze its token delta.
  function closeLiveRec(now) { if (liveRec && liveRec.end == null) { liveRec.end = now; liveRec.tokEnd = lastTokens; if (liveRec.t) setThoughtMeta(liveRec.t); } }
  // Tick the active thought's meta ~10×/s so the seconds run like a stopwatch.
  var secTick = null;
  function startSecTick() { if (secTick) return; secTick = setInterval(function () { if (curThought) setThoughtMeta(curThought); else stopSecTick(); }, 100); }
  function stopSecTick() { if (secTick) { clearInterval(secTick); secTick = null; } }
  // One run = one continuous thread (rail) holding all its nodes.
  function ensureRun() { if (curRun) return curRun; fresh(); curRun = document.createElement('div'); curRun.className = 'run'; log.appendChild(curRun); return curRun; }
  function endThought() { if (curThought) { setThoughtMeta(curThought); if (curThought.node) curThought.node.classList.remove('active'); } curThought = null; }
  function endSection(endSnapshot) {
    if (typeof endSnapshot === 'number') lastTokens = endSnapshot;
    closeLiveRec(Date.now()); pendingRec = null; liveRec = null;
    endThought();
    if (curRun) { var lives = curRun.querySelectorAll('.node.live'); for (var i = 0; i < lives.length; i++) lives[i].classList.remove('live'); }
    curRun = null;
    stopSecTick();
    updateWorking();
  }
  // A thread node: a dot on the rail (the rail line is the node's full-height
  // left column) + a body. kind = 'think' (accent dot) | 'op' (small dim dot).
  function makeNode(kind) {
    var n = document.createElement('div'); n.className = 'node ' + kind;
    var rail = document.createElement('span'); rail.className = 'node-rail';
    var body = document.createElement('div'); body.className = 'node-body';
    n.appendChild(rail); n.appendChild(body);
    return { node: n, body: body };
  }
  // ── Render queue: events arrive in bursts; render them one at a time (each op
  //    types fully before the next starts) so the stream reads sequentially and
  //    the scroll keeps up — never several lines flashing in at once. ──
  var renderQ = [], renderBusy = false;
  function enqueue(task) { renderQ.push(task); pumpQ(); }
  function pumpQ() {
    if (renderBusy) return;
    var task = renderQ.shift();
    if (!task) return;
    renderBusy = true;
    task(function () { renderBusy = false; scroll(); pumpQ(); });
  }
  function clearQ() { renderQ = []; renderBusy = false; }
  function _renderNarration(rec) {
    ensureRun(); endThought();
    var nd = makeNode('think active');
    var meta = document.createElement('span'); meta.className = 'node-meta'; nd.body.appendChild(meta);
    var th = document.createElement('span'); th.className = 'think-text'; th.innerHTML = inline(rec.text); nd.body.appendChild(th);
    curRun.appendChild(nd.node);
    curThought = { node: nd.node, meta: meta, rec: rec }; rec.t = curThought;
    setThoughtMeta(curThought); startSecTick(); updateWorking(); scroll();
  }
  // A narration is held PENDING and only rendered once its first browser op
  // arrives (or the next narration supersedes it). The run's final message also
  // arrives as a narration but has no ops after it and is followed by the result
  // — so it stays pending and gets discarded, never flashing into the stream.
  function flushThought() { if (pendingRec) { var r = pendingRec; pendingRec = null; _renderNarration(r); } }
  // Each AI narration is a thinking node. Its record is stamped NOW (real arrival)
  // and the previous thought is closed NOW, so timing is real regardless of when
  // the queue renders it. A fenced code block (the final JSON report) is dropped.
  function addNarration(text) {
    if (!text) return;
    var fi = text.indexOf(String.fromCharCode(96, 96, 96)); if (fi >= 0) text = text.slice(0, fi);
    text = text.trim(); if (!text) return;
    var now = Date.now();
    closeLiveRec(now); // the previous thought ends the moment this one begins
    var rec = { text: text, start: now, end: null, tokStart: lastTokens, tokEnd: lastTokens, t: null };
    liveRec = rec;
    if (replaying) { flushThought(); pendingRec = rec; return; }
    enqueue(function (next) { flushThought(); pendingRec = rec; next(); });
  }
  function _renderStep(m, done) {
    flushThought(); ensureRun();
    var prev = curRun.querySelector('.node.op.live'); if (prev) prev.classList.remove('live');
    var nd = makeNode('op live' + (m.isError ? ' error' : ''));
    curRun.appendChild(nd.node);
    speak(m.label); scroll();
    typeInto(nd.body, describeOp(m.tool, m.detail, false), done);
  }
  // A browser op is a node on the same thread (verb + value), typed as it lands.
  // Token snapshot is taken NOW (arrival) so the thought's token delta is real.
  function addStep(m) {
    if (typeof m.tokens === 'number') { lastTokens = m.tokens; if (liveRec && liveRec.end == null) { liveRec.tokEnd = lastTokens; if (liveRec.t) setThoughtMeta(liveRec.t); } }
    if (isQuietStep(m)) return; // keep read-only / navigation noise out of the stream
    if (replaying) { _renderStep(m, function () {}); return; }
    enqueue(function (next) { _renderStep(m, next); });
  }
  function addResult(m) {
    if (replaying) { _renderResult(m); return; }
    enqueue(function (next) { _renderResult(m); next(); });
  }
  function _renderResult(m) {
    fresh();
    // The run's final message is still a pending thought (never rendered) — the
    // Done card below shows it. Discard so it never flashes into the stream.
    if (typeof m.tokens === 'number') lastTokens = m.tokens;
    pendingRec = null;
    endSection(typeof m.tokens === 'number' ? m.tokens : undefined);
    // Structured-first: if the engine handed us parsed findings (from the
    // agent's JSON block), render the card from data and keep the summary whole.
    // Only fall back to scraping Markdown when no structured findings arrived.
    var struct = Array.isArray(m.findings) ? m.findings : null;
    var parsed = struct ? { main: m.summary || '', findings: null } : splitFindings(m.summary || '');
    var isErr = m.verdict && /fail|error|blocked/i.test(m.verdict);
    // A plain conversational block (图3): ✓ + verdict, the summary prose, inline
    // findings, a dim meta footer — no card border, no separate Findings card.
    var wrap = document.createElement('div'); wrap.className = 'result' + (isErr ? ' err' : '');
    var h = document.createElement('div'); h.className = 'rhead';
    var chk = document.createElement('span'); chk.className = 'rcheck'; chk.textContent = isErr ? '✗' : '✓'; h.appendChild(chk);
    var lbl = document.createElement('span'); lbl.textContent = m.verdict || 'Done'; h.appendChild(lbl);
    h.appendChild(makeCopyBtn(function () { return parsed.main; }));
    wrap.appendChild(h);
    var body = document.createElement('div'); body.className = 'md'; body.innerHTML = mdToHtml(parsed.main); wrap.appendChild(body);
    if (struct && struct.length) appendInlineFindings(wrap, struct);
    else if (parsed.findings) appendInlineFindingsText(wrap, parsed.findings);
    var metaBits = [];
    if (m.steps) metaBits.push(m.steps + (m.steps > 1 ? ' steps' : ' step'));
    if (typeof m.tokens === 'number' && m.tokens > 0) metaBits.push(fmtTokens(m.tokens));
    if (metaBits.length) { var f = document.createElement('div'); f.className = 'rfoot'; f.textContent = metaBits.join(' · '); wrap.appendChild(f); }
    // Save is a BUTTON on the Done block (not an auto-popup) — click it to name +
    // save this run. The click opens the filename + findings-warning prompt, and
    // addSaveCard routes by mode (api-test → request spec, pentest → report).
    // Skip when there's nothing to save (a no-step Q&A run outside pentest).
    // Bind Save to THIS run's mode (m.mode), not the live mode — so switching
    // modes after a run can't route its save to the wrong writer.
    var runMode = m.mode || null;
    if (!replaying && (runMode === 'pentest' || (m.steps && m.steps > 0))) {
      var fc = struct ? struct.filter(function (f2) { return f2 && (f2.text || f2.title); }).length : 0;
      var saveBtn = document.createElement('button'); saveBtn.className = 'saveas';
      saveBtn.textContent = runMode === 'pentest' ? 'Save findings report' : 'Save as spec';
      saveBtn.addEventListener('click', function () { addSaveCard({ mode: runMode, findings: fc }); });
      wrap.appendChild(saveBtn);
    }
    log.appendChild(wrap);
    speak((m.verdict || 'Pass') + '. ' + parsed.main.replace(/[#*\`|>_-]+/g, ' '));
    scroll();
  }
  // In-chat ask_user card: the agent is blocked and needs a human decision.
  // Renders the question + option buttons + an always-present "Other" free-text
  // row; posts the answer back and locks the card.
  function addAskCard(m) {
    fresh();
    askDock.innerHTML = ''; // one active prompt at a time
    var card = document.createElement('div'); card.className = 'ask';
    var h = document.createElement('div'); h.className = 'ask-q'; h.innerHTML = inline(m.question || 'Hover needs your input'); card.appendChild(h);
    var opts = document.createElement('div'); opts.className = 'ask-opts'; card.appendChild(opts);
    var done = false;
    function answer(val) {
      if (done) return; done = true;
      askDock.hidden = true; askDock.innerHTML = ''; setAskActive(false);
      // Don't leave a bulky resolved card — the question is already implied by the
      // flow. Drop one concise answer node onto the thread, with a subject so it
      // reads as a sentence ("You answered: Male" / "You dismissed the question").
      ensureRun();
      var nd = makeNode('op answered');
      nd.body.innerHTML = (val == null ? 'You dismissed the question' : 'You answered: ' + inline(val));
      curRun.appendChild(nd.node);
      vscode.postMessage({ type: 'askUserAnswer', askId: m.askId, value: val });
      scroll();
    }
    (Array.isArray(m.options) ? m.options : []).forEach(function(o){
      if (!o || !o.label) return;
      var b = document.createElement('button'); b.className = 'ask-opt';
      var t = document.createElement('span'); t.innerHTML = inline(o.label); b.appendChild(t);
      if (o.description) { var d = document.createElement('small'); d.innerHTML = inline(o.description); b.appendChild(d); }
      b.addEventListener('click', function(){ answer(o.label); });
      opts.appendChild(b);
    });
    // Free-text answer — an always-present inline row (pencil + input + ↵ button),
    // NOT a separate "Other" option that expands. Omitted for permission cards
    // (m.other === false), where a typed instruction makes no sense.
    if (m.other !== false) {
      var row = document.createElement('div'); row.className = 'ask-other-row';
      var pencil = document.createElement('span'); pencil.className = 'ask-pencil'; pencil.innerHTML = ICON_PENCIL;
      var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = 'Type your own answer…';
      var go = document.createElement('button'); go.className = 'ask-go'; go.title = 'Send'; go.innerHTML = ICON_ARROW;
      row.appendChild(pencil); row.appendChild(inp); row.appendChild(go); card.appendChild(row);
      var submitOther = function(){ var v = inp.value.trim(); if (v) answer(v); };
      go.addEventListener('click', submitOther);
      inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); submitOther(); } });
    }
    askDock.appendChild(card);
    askDock.hidden = false; setAskActive(true);
    scroll();
  }
  // After-run save prompt (replaces the old "Save as spec" button): asks whether
  // to crystallize the run + the filename, in the composer's place. If the agent
  // flagged findings, warn that the spec still records the flow as passing.
  function addSaveCard(info) {
    fresh();
    askDock.innerHTML = '';
    var saveMode = info && info.mode ? info.mode : null;
    var isPentest = saveMode === 'pentest';
    var card = document.createElement('div'); card.className = 'ask';
    var h = document.createElement('div'); h.className = 'ask-q';
    h.textContent = isPentest ? 'Save this run as a findings report?' : 'Save this run as a spec?';
    card.appendChild(h);
    if (info && info.findings > 0 && !isPentest) {
      var warn = document.createElement('div'); warn.className = 'ask-warn';
      warn.textContent = '⚠ The agent flagged ' + info.findings + (info.findings > 1 ? ' issues' : ' issue') + '. The spec records the flow as passing — it won\\'t fail on these. Save anyway?';
      card.appendChild(warn);
    }
    var row = document.createElement('div'); row.className = 'ask-other-row';
    var inp = document.createElement('input'); inp.type = 'text';
    inp.placeholder = isPentest ? 'Report name — e.g. scan' : 'Spec name — e.g. login-flow';
    row.appendChild(inp); card.appendChild(row);
    var btns = document.createElement('div'); btns.className = 'ask-btns';
    var disc = document.createElement('button'); disc.className = 'ask-discard'; disc.textContent = 'Discard';
    var save = document.createElement('button'); save.className = 'ask-send'; save.textContent = isPentest ? 'Save report' : 'Save spec';
    btns.appendChild(disc); btns.appendChild(save); card.appendChild(btns);
    var done = false;
    function close() { if (done) return; done = true; askDock.hidden = true; askDock.innerHTML = ''; setAskActive(false); scroll(); }
    function doSave() { var v = inp.value.trim(); if (!v) { inp.focus(); return; } close(); vscode.postMessage({ type: 'saveRun', name: v, mode: saveMode }); }
    save.addEventListener('click', doSave);
    disc.addEventListener('click', close);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSave(); } else if (e.key === 'Escape') { close(); } });
    askDock.appendChild(card);
    askDock.hidden = false; setAskActive(true);
    inp.focus(); scroll();
  }
  // Re-render the chat from a switched conversation's saved transcript.
  function loadSession(tx){
    setBusy(null); if (busyTimer) { clearInterval(busyTimer); busyTimer=null; } stopSecTick(); clearQ();
    workingEl=null; running=false; document.body.classList.remove('running');
    askDock.hidden=true; askDock.innerHTML=''; setAskActive(false);
    log.innerHTML=""; curRun=null; curThought=null; pendingRec=null; liveRec=null; lastTokens=0; cleared=true;
    var arr = Array.isArray(tx) ? tx : [];
    if (!arr.length) { cleared=false; log.appendChild(emptyEl()); syncSend(); return; }
    replaying = true;
    arr.forEach(function(m){
      if (m.kind==='user') addMessage('user', m.text || '');
      // Agent narration becomes the NEXT group's title (same as live), so steps
      // fold under it instead of opening tool-named groups. Genuine system lines
      // stay as messages. No TTS on replay (the replaying guard mutes speak).
      else if (m.kind==='ai' || m.kind==='assistant') addNarration(m.text || '');
      else if (m.kind==='system') { if (m.text) addMessage('system', m.text); }
      else if (m.kind==='step') addStep({ tool: m.tool, label: m.label || m.tool, detail: m.input != null ? JSON.stringify(m.input) : '', isError: m.isError });
      else if (m.kind==='done') addResult({ verdict: 'Done', summary: m.summary || '', findings: m.findings });
    });
    if (curRun) endSection();
    replaying = false;
    syncSend(); scroll();
  }
  function sevClass(s) {
    s = (s || '').toLowerCase();
    if (s === 'bug' || s === 'major' || s === 'high' || s === 'critical' || /严重|高危|高/.test(s)) return 'bug';
    if (s === 'info' || s === 'note' || /提示|信息/.test(s)) return 'info';
    return 'minor';
  }
  // A badge is only a SHORT severity tag. The agent sometimes bolds a whole
  // sentence ("**严重 Bug — Sex … 无法选择**"); that's emphasis, not a tag, so we
  // fold a long "marker" back into the text instead of rendering a giant badge.
  function badgeWord(marker) {
    if (!marker) return null;
    var m = marker.trim();
    if (m.length <= 12 && !/\\s.*\\s/.test(m)) return m; // ≤12 chars, at most one space
    return null;
  }
  // A single inline finding row: severity badge + html body. Appended directly
  // into the result block (no separate Findings card).
  function findingRow(word, html) {
    var row = document.createElement('div'); row.className = 'finding';
    if (word) { var b = document.createElement('span'); b.className = 'badge ' + sevClass(word); b.textContent = word; row.appendChild(b); }
    var span = document.createElement('span'); span.innerHTML = html; row.appendChild(span);
    row.appendChild(makeCopyBtn(function () { return (word ? word + ' — ' : '') + span.textContent; }));
    return row;
  }
  // Inline findings from STRUCTURED data (the agent's JSON block, parsed by the
  // engine): severity badge + optional bold title + detail. No Markdown scraping.
  function appendInlineFindings(container, arr) {
    arr.filter(function (f) { return f && (f.text || f.title); }).forEach(function (f) {
      var word = badgeWord(f.severity);
      var body = (f.title && f.title !== f.text) ? '**' + f.title + '** — ' + (f.text || '') : (f.text || f.title || '');
      var ep = f.method || f.endpoint ? ' \`' + [f.method, f.endpoint].filter(Boolean).join(' ') + '\`' : '';
      container.appendChild(findingRow(word, inline(body + ep)));
    });
  }
  function appendInlineFindingsText(container, text) {
    text.split('\\n').forEach(function (line) {
      if (!line.trim()) return;
      var marker = null, rest = null;
      // A leading severity word ("Bug — …", "- **Minor** — …", "Critical: …").
      var sv = line.match(/^\\s*(?:[-*]\\s*)?\\**\\s*(critical|high|medium|low|bug|major|minor|issue|warning|vuln(?:erability)?|security|note|info)\\b\\s*\\**\\s*[—–:\\-]\\s*([\\s\\S]+)$/i);
      // Else "- **Marker** — rest" OR a plain "- rest" bullet. Don't blindly
      // strip leading '*' (that would eat the opening ** of a bold marker).
      var b = line.match(/^\\s*[-*]\\s+(?:\\*\\*\\s*([^*]+?)\\s*\\*\\*\\s*[—–:\\-]?\\s*)?([\\s\\S]+)$/);
      if (sv) { marker = sv[1]; rest = sv[2]; }
      else if (b) { marker = b[1]; rest = b[2]; }
      else { rest = line.trim(); }
      var word = badgeWord(marker);
      if (!word && marker) { rest = '**' + marker + '** ' + rest; } // long bold = sentence, keep inline
      container.appendChild(findingRow(word, inline(rest)));
    });
  }
  // Split a summary into the main body + the Findings BULLET LIST only. The
  // heading + its bullets are removed from main; everything else (incl. a
  // results table that may follow Findings) stays in main so it renders as a
  // proper markdown block — not line-by-line.
  function splitFindings(s) {
    var lines = s.split('\\n');
    // A finding line: optional bullet/bold, a severity word, then a dash/colon
    // (matches "- **Bug** — …", "Bug — …", "Minor: …", "Critical — …").
    var SEV = /^\\s*(?:[-*]\\s*)?\\**\\s*(critical|high|medium|low|bug|major|minor|issue|warning|vuln(?:erability)?|security|note|info)\\b\\s*\\**\\s*[—–:\\-]/i;
    // 1) An explicit "## Findings" heading → the bullet / severity lines under it.
    var hi = -1;
    for (var i = 0; i < lines.length; i++) { var t = lines[i].trim(); if (/^#{1,6}\\s*(findings|bugs|issues)\\b/i.test(t) || /^findings\\s*:/i.test(t)) { hi = i; break; } }
    if (hi >= 0) {
      var j = hi + 1; while (j < lines.length && lines[j].trim() === '') j++;
      var start = j; while (j < lines.length && (lines[j].trim() === '' || /^\\s*[-*]\\s+/.test(lines[j]) || SEV.test(lines[j]))) j++;
      var block = lines.slice(start, j).filter(function (l) { return l.trim() !== ''; });
      var main = lines.slice(0, hi).concat(lines.slice(j)).join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
      return { main: main, findings: block.length ? block.join('\\n') : null };
    }
    // 2) No heading — pull the contiguous run of severity-prefixed lines (the
    //    free-form "Bug — … / Minor — …" report style the agent often emits),
    //    leaving the intro prose + any results table in main.
    var fs = -1;
    for (var k = 0; k < lines.length; k++) { if (SEV.test(lines[k])) { fs = k; break; } }
    if (fs < 0) return { main: s, findings: null };
    var e = fs, block2 = [];
    while (e < lines.length) {
      if (lines[e].trim() === '') { var n = e + 1; while (n < lines.length && lines[n].trim() === '') n++; if (n < lines.length && SEV.test(lines[n])) { e = n; continue; } break; }
      if (SEV.test(lines[e])) { block2.push(lines[e]); e++; } else break;
    }
    var main2 = lines.slice(0, fs).concat(lines.slice(e)).join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
    return { main: main2, findings: block2.length ? block2.join('\\n') : null };
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
      if (/^\\s*([-*_])\\1{2,}\\s*$/.test(line)) { out.push('<hr/>'); i++; continue; } // --- *** ___ rule
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
  var sessionMenu = document.getElementById('session-menu');
  var sessionList = [], activeSess = '';
  var models = [], currentModel = '';
  var MODE_ICONS = {
    normal:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.2H11l-1 8.8 8.6-12.2H12.1L13 2z"/></svg>',
    'api-test': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6l7-3z"/></svg>',
    pentest:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3a7 7 0 0 0-3.6 13V18a1 1 0 0 0 1 1H10v-2M12 3a7 7 0 0 1 3.6 13V18a1 1 0 0 1-1 1H14v-2M9.5 19h5"/><circle cx="9.2" cy="11.5" r="1.4" fill="currentColor"/><circle cx="14.8" cy="11.5" r="1.4" fill="currentColor"/></svg>',
  };
  var MODES = [
    { value:'normal',   icon:MODE_ICONS.normal,   title:'Frontend', desc:'AI drives your app & saves a Playwright spec' },
    { value:'api-test', icon:MODE_ICONS['api-test'], title:'API testing', tag:'Experimental', desc:'Drive & verify your API — auth, status codes, access control' },
    { value:'pentest',  icon:MODE_ICONS.pentest,  title:'Pentest',  tag:'Experimental', desc:'Offensive scan of your OWN app → findings report' },
  ];
  document.getElementById('mode-icon').innerHTML = MODE_ICONS[currentModeId || 'normal'];
  function renderPicker(menuEl, header, items, activeVal){
    menuEl.innerHTML = '<div class="p-hdr">'+esc(header)+'</div>' + items.map(function(it){
      return '<div class="p-item'+(it.value===activeVal?' active':'')+'" data-v="'+esc(String(it.value))+'">'
        + (it.icon ? '<span class="p-ic">'+it.icon+'</span>' : '')
        + '<div class="p-body"><div class="p-title">'+esc(it.title)+(it.tag ? ' <span class="p-tag">'+esc(it.tag)+'</span>' : '')+'</div>'
        + (it.desc ? '<div class="p-desc">'+esc(it.desc)+'</div>' : '')
        + '</div><span class="p-check">✓</span></div>';
    }).join('');
  }
  function closePickers(){ modeMenu.hidden = true; modelMenu.hidden = true; sessionMenu.hidden = true; }
  // The session switcher dropdown mirrors the Conversations sidebar: Local /
  // Cloud (locked) tabs + a search box + the conversation rows. Cloud is a
  // placeholder until Hover Cloud. A running conversation shows a pulse dot.
  var sessTab = 'local', sessQ = '';
  var SESS_LOCK = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/></svg>';
  var SESS_SEARCH = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13.5 13.5" stroke-linecap="round"/></svg>';
  function sessRows(){
    var ql = sessQ.trim().toLowerCase();
    return sessionList.filter(function(s){ return !ql || (s.name||'').toLowerCase().indexOf(ql) !== -1; });
  }
  function renderSessList(){
    var box = sessionMenu.querySelector('.sess-list'); if (!box) return;
    if (sessTab === 'cloud') { box.innerHTML = '<div class="sess-cloud">☁ Cloud sessions are coming soon.</div>'; return; }
    var rows = sessRows();
    var html = rows.map(function(s){
      return '<div class="p-item'+(s.id===activeSess?' active':'')+'" data-v="'+esc(s.id)+'">'
        + '<div class="p-body"><div class="p-title">'+esc(s.name)+'</div></div>'
        + (s.running ? '<span class="p-run"></span>' : '<span class="p-check">✓</span>')
        + '</div>';
    }).join('');
    if (!rows.length) html = '<div class="sess-cloud">'+(sessionList.length?'No conversations match.':'No conversations yet.')+'</div>';
    html += '<div class="p-item" data-v="__new__"><div class="p-body"><div class="p-title">＋ New session</div></div></div>';
    box.innerHTML = html;
  }
  function renderSessShell(){
    sessionMenu.innerHTML = '<div class="p-hdr">Conversations</div>'
      + '<div class="sess-tabs">'
      + '<div class="sess-tab'+(sessTab==='local'?' active':'')+'" data-tab="local">Local</div>'
      + '<div class="sess-tab locked'+(sessTab==='cloud'?' active':'')+'" data-tab="cloud">'+SESS_LOCK+'<span>Cloud</span></div>'
      + '</div>'
      + '<div class="sess-search"'+(sessTab==='cloud'?' hidden':'')+'>'+SESS_SEARCH+'<input id="sess-q" type="text" placeholder="Search sessions…" value="'+esc(sessQ)+'"/></div>'
      + '<div class="sess-list"></div>';
    renderSessList();
  }
  function toggleSessionMenu(){
    if (!sessionMenu.hidden) { sessionMenu.hidden = true; return; }
    closePickers();
    renderSessShell();
    sessionMenu.hidden = false;
  }
  // Row switch / new (mousedown so it beats the outside-close).
  sessionMenu.addEventListener('mousedown', function(e){
    var r = e.target && e.target.closest ? e.target.closest('.p-item') : null; if (!r) return;
    e.preventDefault(); var v = r.getAttribute('data-v'); sessionMenu.hidden = true;
    if (v === '__new__') vscode.postMessage({ type:'command', id:'hover.newSession' });
    else if (v !== activeSess) vscode.postMessage({ type:'switchSession', id:v });
  });
  // Tab switch (Local / Cloud) — rebuild the shell, keep the menu open.
  sessionMenu.addEventListener('click', function(e){
    var t = e.target && e.target.closest ? e.target.closest('.sess-tab') : null; if (!t) return;
    sessTab = t.getAttribute('data-tab') || 'local'; renderSessShell();
  });
  // Search filter — refresh only the list so the input keeps focus.
  sessionMenu.addEventListener('input', function(e){
    if (!e.target || e.target.id !== 'sess-q') return;
    sessQ = e.target.value; renderSessList();
  });
  function toggleModeMenu(){
    if (!modeMenu.hidden) { modeMenu.hidden = true; return; }
    closePickers(); renderPicker(modeMenu, 'Mode', MODES, currentModeId || 'normal'); modeMenu.hidden = false;
  }
  // Model menu: the model rows (a disabled one greys out + can't be picked),
  // then a reasoning-effort chip row for the current model (hidden when the
  // model has no effort control, e.g. Haiku).
  var effortOpts = [], curEffort = '', modelLocked = false;
  function renderModelMenu(){
    var html = '<div class="p-hdr">Model</div>' + models.map(function(x){
      return '<div class="p-item'+(x.value===currentModel?' active':'')+(x.disabled?' disabled':'')+'" data-v="'+esc(x.value)+'"'+(x.disabled?' data-disabled="1"':'')+'>'
        + '<div class="p-body"><div class="p-title">'+esc(x.label)+(x.disabled?' <span class="p-tag">Soon</span>':'')+'</div>'
        + (x.desc?'<div class="p-desc">'+esc(x.desc)+'</div>':'')+'</div>'
        + '<span class="p-check">✓</span></div>';
    }).join('');
    if (effortOpts.length) {
      html += '<div class="p-hdr eff-hdr">Reasoning effort</div><div class="eff-row">'
        + effortOpts.map(function(lv){ return '<button class="eff-chip'+(lv===curEffort?' active':'')+'" data-eff="'+esc(lv)+'">'+esc(lv)+'</button>'; }).join('')
        + '</div>';
    }
    modelMenu.innerHTML = html;
  }
  function toggleModelMenu(){
    if (modelLocked) return; // Local LLM: model is set in Settings, not here
    if (!modelMenu.hidden) { modelMenu.hidden = true; return; }
    if (!models.length) return;
    closePickers();
    renderModelMenu();
    modelMenu.hidden = false;
  }
  modeMenu.addEventListener('mousedown', function(e){
    var r = e.target && e.target.closest ? e.target.closest('.p-item') : null; if (!r) return;
    e.preventDefault(); var v = r.getAttribute('data-v'); modeMenu.hidden = true;
    vscode.postMessage({ type:'setMode', modeId: v==='normal' ? null : v });
  });
  modelMenu.addEventListener('mousedown', function(e){
    var r = e.target && e.target.closest ? e.target.closest('.p-item') : null; if (!r) return;
    e.preventDefault();
    if (r.getAttribute('data-disabled')) return; // not yet selectable
    var v = r.getAttribute('data-v'); modelMenu.hidden = true;
    vscode.postMessage({ type:'setModel', value: v });
  });
  // Effort chip → apply (menu stays open; the 'models' refresh re-checks it).
  modelMenu.addEventListener('click', function(e){
    var c = e.target && e.target.closest ? e.target.closest('.eff-chip') : null; if (!c) return;
    vscode.postMessage({ type:'setEffort', value: c.getAttribute('data-eff') });
  });
  document.getElementById('mode').addEventListener('click', function(e){ e.stopPropagation(); toggleModeMenu(); });
  document.getElementById('model-btn').addEventListener('click', function(e){ e.stopPropagation(); toggleModelMenu(); });
  document.getElementById('session').addEventListener('click', function(e){ e.stopPropagation(); toggleSessionMenu(); });
  document.getElementById('browser-toggle').addEventListener('click', cmd('hover.toggleBrowser'));
  document.getElementById('new').addEventListener('click', cmd('hover.newSession'));
  document.getElementById('appstatus').addEventListener('click', cmd('hover.appStatus'));
  document.addEventListener('mousedown', function(e){
    var t = e.target;
    if (!t || !t.closest || !t.closest('#mode-menu,#mode')) modeMenu.hidden = true;
    if (!t || !t.closest || !t.closest('#model-menu,#model-btn')) modelMenu.hidden = true;
    if (!t || !t.closest || !t.closest('#session-menu,#session')) sessionMenu.hidden = true;
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
  function updateWorking(){ setWorking(running && !curRun); }

  window.addEventListener('message', function(e){
    var m = e.data; if (!m) return;
    if (m.type==='user'||m.type==='system'||m.type==='assistant') addMessage(m.type, m.text);
    else if (m.type==='askUser') addAskCard(m);
    else if (m.type==='sessions') {
      sessionList = Array.isArray(m.list) ? m.list : []; activeSess = m.activeId || '';
      var a = sessionList.find(function(s){ return s.id===activeSess; });
      document.getElementById('session-label').textContent = (a && a.name) || 'New session';
      // Pulsing dot on the collapsed button when a run is active in ANOTHER conversation.
      var bg = sessionList.some(function(s){ return s.running && s.id !== activeSess; });
      document.getElementById('session-run').hidden = !bg;
      if (!sessionMenu.hidden) renderSessList();
    }
    else if (m.type==='loadSession') loadSession(m.transcript);
    else if (m.type==='narration') addNarration(m.text);
    else if (m.type==='step') addStep(m);
    else if (m.type==='usage') { if (typeof m.tokens === 'number') { lastTokens = m.tokens; if (liveRec && liveRec.end == null) { liveRec.tokEnd = lastTokens; if (liveRec.t) setThoughtMeta(liveRec.t); } } }
    else if (m.type==='result') addResult(m);
    else if (m.type==='reset') { setBusy(null); if (busyTimer) { clearInterval(busyTimer); busyTimer=null; } stopSecTick(); clearQ(); workingEl=null; running=false; askDock.hidden=true; askDock.innerHTML=''; setAskActive(false); log.innerHTML=''; cleared=false; curRun=null; curThought=null; pendingRec=null; liveRec=null; lastTokens=0; log.appendChild(emptyEl()); input.value=''; syncSend(); }
    else if (m.type==='mode') {
      currentModeId = m.id || null;
      document.getElementById('mode-label').textContent = m.id ? (m.label||m.id) : 'Frontend';
      document.getElementById('mode-icon').innerHTML = MODE_ICONS[m.id==='pentest' ? 'pentest' : (m.id==='api-test' ? 'api-test' : 'normal')];
      document.body.classList.remove('mode-api-test','mode-pentest');
      if (m.id) document.body.classList.add('mode-'+m.id);
      if (!modeMenu.hidden) renderPicker(modeMenu, 'Mode', MODES, currentModeId || 'normal');
      applyBorder();
    }
    else if (m.type==='models') {
      models = Array.isArray(m.models) ? m.models : [];
      currentModel = m.current || '';
      effortOpts = (m.effort && Array.isArray(m.effort.options)) ? m.effort.options : [];
      curEffort = (m.effort && m.effort.current) || '';
      modelLocked = !!m.locked;
      var found = models.filter(function(x){ return x.value===currentModel; })[0];
      document.getElementById('model-label').textContent = (found && found.label) || currentModel || 'Model';
      var mb = document.getElementById('model-btn'); mb.classList.toggle('locked', modelLocked); mb.title = modelLocked ? 'Local LLM — model is set in Settings' : 'Model — click to switch';
      if (modelLocked) modelMenu.hidden = true;
      if (!modelMenu.hidden) renderModelMenu();
    }
    else if (m.type==='appstatus') {
      var dot=document.getElementById('app-dot'); var lab=document.getElementById('app-label'); var btn=document.getElementById('appstatus');
      if (m.label) { lab.textContent = m.online ? String(m.label) : String(m.label)+' (offline)'; dot.className = m.online ? 'dot' : 'dot offline'; if(btn&&m.title) btn.title = String(m.title); }
      else { lab.textContent='Set target'; dot.className='dot offline'; }
    }
    else if (m.type==='accounts') { accounts = Array.isArray(m.accounts) ? m.accounts : []; }
    else if (m.type==='busy') { setBusy(m.done ? null : (m.text||'Working…')); }
    else if (m.type==='running') { running = !!m.running; document.body.classList.toggle('running', running); if (running) { clearQ(); curRun = null; curThought = null; pendingRec = null; liveRec = null; lastTokens = 0; closePickers(); } else { enqueue(function (next) { if (curRun) endSection(); next(); }); } updateWorking(); applyBorder(); syncSend(); }
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
