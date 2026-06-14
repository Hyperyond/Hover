/**
 * The Hover "Sessions" view — the agent-run ledger.
 *
 * `@hover-dev/core` writes one summary JSON per agent run under
 * `<project>/.hover/sessions/`: agent, model, cost, turns, outcome. This view
 * surfaces them read-only so the developer can see what each Hover run did and
 * what it cost (the active billing-risk concern). Newest first.
 */
import * as vscode from 'vscode';

interface SessionSummary {
  agent?: string;
  model?: string;
  costUsd?: number;
  cost?: number;
  turns?: number;
  outcome?: string;
  prompt?: string;
  startedAt?: number;
  mode?: string;
}

class SessionItem extends vscode.TreeItem {
  constructor(uri: vscode.Uri, s: SessionSummary) {
    const title = (s.prompt || s.outcome || uri.path.split('/').pop() || 'session').slice(0, 80);
    super(title, vscode.TreeItemCollapsibleState.None);
    const cost = s.costUsd ?? s.cost;
    const bits = [s.model ?? s.agent, cost != null ? `$${cost.toFixed(3)}` : null, s.turns != null ? `${s.turns} turns` : null]
      .filter(Boolean)
      .join(' · ');
    this.description = bits;
    this.tooltip = [
      s.agent && `agent: ${s.agent}`,
      s.model && `model: ${s.model}`,
      cost != null && `cost: $${cost}`,
      s.turns != null && `turns: ${s.turns}`,
      s.mode && `mode: ${s.mode}`,
      s.outcome && `outcome: ${s.outcome}`,
    ]
      .filter(Boolean)
      .join('\n');
    this.iconPath = new vscode.ThemeIcon(outcomeIcon(s.outcome));
    this.resourceUri = uri;
    this.command = { command: 'vscode.open', title: 'Open Session JSON', arguments: [uri] };
    this.contextValue = 'hoverSession';
  }
}

function outcomeIcon(outcome?: string): string {
  const o = (outcome ?? '').toLowerCase();
  if (o.includes('error') || o.includes('fail')) return 'error';
  if (o.includes('cancel') || o.includes('abort')) return 'circle-slash';
  if (o.includes('complete') || o.includes('success') || o.includes('done')) return 'pass';
  return 'history';
}

export class SessionsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element) return [];
    const uris = await vscode.workspace.findFiles('**/.hover/sessions/*.json', '**/node_modules/**');
    if (uris.length === 0) return [];
    const rows: { uri: vscode.Uri; s: SessionSummary }[] = [];
    for (const uri of uris) {
      try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        rows.push({ uri, s: JSON.parse(raw) as SessionSummary });
      } catch {
        /* skip unreadable / malformed */
      }
    }
    rows.sort((a, b) => (b.s.startedAt ?? 0) - (a.s.startedAt ?? 0));
    return rows.map((r) => new SessionItem(r.uri, r.s));
  }
}

export function registerSessionsView(): vscode.Disposable[] {
  const provider = new SessionsTreeProvider();
  const view = vscode.window.createTreeView('hover.sessions', { treeDataProvider: provider });
  const refresh = vscode.commands.registerCommand('hover.refreshSessions', () => provider.refresh());
  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/sessions/*.json');
  // Session summaries are written once (append-only) — a later content edit
  // won't change the row, so skip onDidChange to avoid re-reading + re-parsing
  // every session file on each write.
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  return [view, refresh, watcher];
}
