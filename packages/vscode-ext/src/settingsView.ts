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
import { renderWebviewHtml } from './webviewHost.js';
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
  agentContext?: string;
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
  /** Memory mode ('shared' | 'isolated') — stored in extension globalState, not
   *  VS Code config (config scope precedence made the dropdown snap back). */
  getAgentContext(): string;
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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: SettingsHandlers,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'settings');
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
      agentContext: this.handlers.getAgentContext(),
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

}

export function registerSettingsView(extensionUri: vscode.Uri, handlers: SettingsHandlers): { provider: SettingsViewProvider; disposable: vscode.Disposable } {
  const provider = new SettingsViewProvider(extensionUri, handlers);
  const disposable = vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposable };
}
