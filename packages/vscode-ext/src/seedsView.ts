/**
 * The Hover "Seeds" view — project security probe seeds.
 *
 * Lists the seeds a project ships under `.hover/rules/` (flat) and
 * `.hover/rules/security/` — the JSON files the probe engine loads. A seed is
 * recognised by its `probe` block (optimization seeds, which have `signature`
 * instead, are skipped). Grouped by category (authz / vuln) so the security vs
 * pentest split is visible. Click to open; "+" scaffolds a new one.
 */
import * as vscode from 'vscode';

interface SeedFile {
  name?: string;
  class?: string;
  category?: string;
  probe?: unknown;
}

class SeedItem extends vscode.TreeItem {
  constructor(uri: vscode.Uri, seed: SeedFile) {
    super(seed.name || uri.path.split('/').pop() || 'seed', vscode.TreeItemCollapsibleState.None);
    this.description = seed.class ?? '';
    this.tooltip = `${vscode.workspace.asRelativePath(uri)}${seed.class ? `\nclass: ${seed.class}` : ''}`;
    this.iconPath = new vscode.ThemeIcon(seed.category === 'vuln' ? 'flame' : 'law');
    this.resourceUri = uri;
    this.command = { command: 'vscode.open', title: 'Open Seed', arguments: [uri] };
    this.contextValue = 'hoverSeed';
  }
}

class SeedCategoryItem extends vscode.TreeItem {
  constructor(label: string, icon: string, readonly children: SeedItem[]) {
    super(`${label} (${children.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'hoverSeedCategory';
  }
}

export class SeedsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof SeedCategoryItem) return element.children;
    if (element) return [];

    const uris = await vscode.workspace.findFiles('**/.hover/rules/**/*.json', '**/node_modules/**');
    const authz: SeedItem[] = [];
    const vuln: SeedItem[] = [];
    for (const uri of uris) {
      try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
        const seed = JSON.parse(raw) as SeedFile;
        if (!seed || typeof seed !== 'object' || !seed.probe) continue; // not a security seed
        (seed.category === 'vuln' ? vuln : authz).push(new SeedItem(uri, seed));
      } catch {
        /* skip malformed */
      }
    }
    if (authz.length === 0 && vuln.length === 0) return []; // viewsWelcome takes over
    const groups: vscode.TreeItem[] = [];
    if (authz.length) groups.push(new SeedCategoryItem('Authorization (authz)', 'law', authz));
    if (vuln.length) groups.push(new SeedCategoryItem('Vulnerability (vuln)', 'flame', vuln));
    return groups;
  }
}

export function registerSeedsView(): vscode.Disposable[] {
  const provider = new SeedsTreeProvider();
  const view = vscode.window.createTreeView('hover.seeds', { treeDataProvider: provider });
  const refresh = vscode.commands.registerCommand('hover.refreshSeeds', () => provider.refresh());
  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/rules/**/*.json');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  return [view, refresh, watcher];
}
