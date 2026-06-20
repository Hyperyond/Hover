/**
 * The Hover "Conversations" view — a sidebar webview listing the multi-session
 * chats (the same conversations the chat top-bar switcher shows), modelled on
 * Claude Code's session sidebar: a Local / Cloud (locked) tab pair, a search
 * box, and one row per conversation showing its name, a "last run N ago" stamp,
 * and a running dot. Hovering a row reveals inline rename / delete.
 *
 * The extension owns the conversation store (ChatSession in workspaceState), so
 * this is a thin presenter: the extension pushes the list via setConversations()
 * and the webview posts back switch / new / rename / delete intents. Rename is
 * edited inline (the row name becomes an input); delete confirms natively. Cloud
 * is a disabled placeholder until Hover Cloud (cross-machine / team sessions).
 */
import * as vscode from 'vscode';
import { renderWebviewHtml } from './webviewHost.js';

export interface ConversationRow {
  id: string;
  name: string;
  /** Epoch ms of this conversation's most recent run (undefined = never run). */
  lastRunAt?: number;
  running?: boolean;
}

export interface ConversationHandlers {
  onSwitch: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export class ConversationsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.sessions';
  private view?: vscode.WebviewView;
  private rows: ConversationRow[] = [];
  private activeId = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: ConversationHandlers,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'conversations');
    view.webview.onDidReceiveMessage((msg: { type: string; id?: string; name?: string }) => {
      if (msg.type === 'ready') { this.push(); return; }
      if (msg.type === 'new') { this.handlers.onNew(); return; }
      if (!msg.id) return;
      if (msg.type === 'switch') this.handlers.onSwitch(msg.id);
      else if (msg.type === 'rename' && typeof msg.name === 'string') this.handlers.onRename(msg.id, msg.name);
      else if (msg.type === 'delete') this.handlers.onDelete(msg.id);
    });
  }

  /** Push the current conversation list + active id to the view. */
  setConversations(rows: ConversationRow[], activeId: string): void {
    this.rows = rows;
    this.activeId = activeId;
    this.push();
  }

  private push(): void {
    void this.view?.webview.postMessage({ type: 'data', rows: this.rows, activeId: this.activeId });
  }

}

/** Register the Conversations webview. The extension wires the handlers +
 *  pushes the list; returns the provider (for setConversations) + disposables. */
export function registerConversationsView(
  extensionUri: vscode.Uri,
  handlers: ConversationHandlers,
): { provider: ConversationsViewProvider; disposables: vscode.Disposable[] } {
  const provider = new ConversationsViewProvider(extensionUri, handlers);
  const view = vscode.window.registerWebviewViewProvider(ConversationsViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  return { provider, disposables: [view] };
}
