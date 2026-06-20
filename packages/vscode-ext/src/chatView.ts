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
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

type Inbound =
  | { type: "send"; text: string }
  | { type: "command"; id: string }
  | { type: "setMode"; modeId: string | null }
  | { type: "setModel"; value: string }
  | { type: "setEffort"; value: string }
  | { type: "askUserAnswer"; askId: string; value: string | null }
  | { type: "switchSession"; id: string }
  | { type: "saveRun"; name: string; mode: string | null }
  | { type: "ready" };

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "hover.chat";
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
  saveRunHandler?: (name: string | undefined, mode: string | null) => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // Allow loading run screenshots (written by Playwright MCP under
    // <workspace>/.hover/screenshots/<session>/) as <img> sources via
    // asWebviewUri — a root grants all its descendants.
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "resources"),
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ...(wsRoot ? [vscode.Uri.joinPath(wsRoot, ".hover", "screenshots")] : []),
      ],
    };
    // The chat is the React webview (Vite build under dist/webview). The legacy
    // string template was removed once the React UI reached parity.
    view.webview.html = this.reactHtml(view.webview);
    view.webview.onDidReceiveMessage((msg: Inbound) => {
      if (msg.type === "send") void this.onSend(msg.text);
      else if (msg.type === "command" && typeof msg.id === "string")
        void vscode.commands.executeCommand(msg.id);
      else if (msg.type === "setMode") this.modeHandler?.(msg.modeId);
      else if (msg.type === "setModel" && typeof msg.value === "string")
        this.modelHandler?.(msg.value);
      else if (msg.type === "setEffort" && typeof msg.value === "string")
        this.effortHandler?.(msg.value);
      else if (msg.type === "askUserAnswer" && typeof msg.askId === "string")
        this.askAnswerHandler?.(msg.askId, msg.value ?? null);
      else if (msg.type === "switchSession" && typeof msg.id === "string")
        this.sessionSwitchHandler?.(msg.id);
      else if (msg.type === "saveRun")
        this.saveRunHandler?.(typeof msg.name === "string" ? msg.name : undefined, msg.mode ?? null);
      else if (msg.type === "ready") this.onReady?.();
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  /** Reveal + focus the chat (used by New Session). */
  async reveal(): Promise<void> {
    await vscode.commands.executeCommand("hover.chat.focus");
  }

  /** Clear the transcript for a new session. */
  newSession(): void {
    this.post({ type: "reset" });
  }

  /** Push the conversation list + active id to the top-bar switcher. */
  setSessions(
    list: { id: string; name: string; running?: boolean }[],
    activeId: string,
  ): void {
    this.post({ type: "sessions", list, activeId });
  }
  /** Re-render the chat with a switched conversation's transcript. */
  loadSession(transcript: { kind: string; [k: string]: unknown }[]): void {
    // Screenshot entries persist an absolute path; re-derive a webview-safe URI
    // here (the webview can't), so reloaded thumbnails still load.
    const mapped = transcript.map((e) => {
      if (e.kind === "shot" && typeof e.path === "string") {
        const uri = this.view?.webview.asWebviewUri(vscode.Uri.file(e.path));
        return { ...e, uri: uri?.toString() };
      }
      return e;
    });
    this.post({ type: "loadSession", transcript: mapped });
  }

  updateMode(id: string | null, label: string | null): void {
    this.post({ type: "mode", id, label: label ?? "Default" });
  }
  updateStatus(text: string): void {
    this.post({ type: "status", text });
  }
  /** Active-environment status shown top-right (label + reachability; the full
   *  URL is the tooltip). `label` is the env name for remote targets, or the
   *  host:port for Local. */
  updateApp(online: boolean, label: string | null, title?: string): void {
    this.post({ type: "appstatus", online, label, title: title ?? label });
  }
  /** Active environment's test accounts for the `@` autocomplete (no passwords). */
  updateAccounts(
    accounts: { label: string; role?: string; username?: string }[],
  ): void {
    this.post({ type: "accounts", accounts });
  }
  /** Push live config to the webview (drives voice + the silent-run border). */
  updateConfig(speech: boolean, silent: boolean): void {
    this.post({ type: "config", speech, silent });
  }
  /** Push the model picker's list for the current agent + the active model,
   *  plus the reasoning-effort options for that model (empty = no effort
   *  control → the picker hides the effort section). */
  updateModels(
    models: {
      value: string;
      label: string;
      desc?: string;
      disabled?: boolean;
    }[],
    current: string,
    effort?: { options: string[]; current: string },
    locked?: boolean,
  ): void {
    this.post({ type: "models", models, current, effort, locked });
  }

  // Streamed run rendering (called by the extension as engine events arrive).
  pushStep(step: {
    label: string;
    tool?: string;
    detail?: string;
    cost?: number;
    tokens?: number;
  }): void {
    this.post({ type: "step", ...step });
  }
  /** AI narration → the next step group's title. */
  pushNarration(text: string): void {
    this.post({ type: "narration", text });
  }
  /** Inline a run screenshot in the thread. `path` is an absolute file path
   *  under <workspace>/.hover/screenshots; converted to a webview-safe URI.
   *  `full` = a full-page shot (preferred over a viewport shot when the chat
   *  collapses a full+viewport burst). */
  pushScreenshot(path: string, full?: boolean): void {
    const uri = this.view?.webview.asWebviewUri(vscode.Uri.file(path));
    if (uri) this.post({ type: "screenshot", uri: uri.toString(), full: !!full });
  }
  /** Running token total (from usage events) → live group counter. */
  pushUsage(tokens: number): void {
    this.post({ type: "usage", tokens });
  }
  pushAssistant(text: string): void {
    this.post({ type: "assistant", text });
  }
  pushSystem(text: string): void {
    this.post({ type: "system", text });
  }
  /** Render an in-chat prompt card (question + options, plus an always-present
   *  "Other" free-text row unless `other:false` — permission cards omit it).
   *  The webview posts back `askUserAnswer` → askAnswerHandler. */
  askUser(req: {
    askId: string;
    question: string;
    options: { label: string; description?: string }[];
    other?: boolean;
  }): void {
    this.post({ type: "askUser", ...req });
  }
  pushResult(
    verdict: string,
    summary: string,
    steps?: number,
    cost?: number,
    tokens?: number,
    findings?: unknown[],
    mode?: string | null,
  ): void {
    this.post({
      type: "result",
      verdict,
      summary,
      steps,
      cost,
      tokens,
      findings,
      mode: mode ?? null,
    });
  }
  setRunning(running: boolean): void {
    this.post({ type: "running", running });
  }
  /** Show a live spinner row with an elapsed timer for an out-of-band job
   *  (e.g. spec optimization, which streams no step events). */
  pushBusy(text: string): void {
    this.post({ type: "busy", text });
  }
  /** Clear the spinner row started by pushBusy(). */
  clearBusy(): void {
    this.post({ type: "busy", done: true });
  }

  private onSend(text: string): void {
    const prompt = text.trim();
    if (!prompt) return;
    this.post({ type: "user", text: prompt });
    if (this.runHandler) this.runHandler(prompt);
    else this.post({ type: "system", text: "Engine not available." });
  }

  /** Host page for the React webview (Vite build under dist/webview). Loads the
   *  bundled chat.js / chat.css via webview URIs; the message protocol with the
   *  extension is unchanged. Shown when `hover.reactChat` is on. */
  private reactHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const dist = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, "chat.js"));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(dist, "chat.css"));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
      `media-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${css}" />
</head><body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }

}

export function registerChatView(extensionUri: vscode.Uri): {
  provider: ChatViewProvider;
  disposable: vscode.Disposable;
} {
  const provider = new ChatViewProvider(extensionUri);
  const disposable = vscode.window.registerWebviewViewProvider(
    ChatViewProvider.viewId,
    provider,
    {
      webviewOptions: { retainContextWhenHidden: true },
    },
  );
  return { provider, disposable };
}
