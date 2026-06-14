/**
 * The Hover sidebar — a native TreeView (no webview) listing the crystallized
 * specs under `__vibe_tests__/`. Native on purpose: the owner wants the
 * extension to look like VSCode, not like the in-page widget (the widget is a
 * layout reference, not a visual-style source).
 *
 * Each spec shows its filename + the stamped `Original prompt:` as the row
 * description; security specs get a distinct icon. Click → open the file. The
 * list auto-refreshes when specs are added/removed.
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { extractOriginalPrompt } from './specLens.js';

class SpecItem extends vscode.TreeItem {
  constructor(uri: vscode.Uri, prompt: string | null) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    const isSecurity = uri.fsPath.endsWith('.security.spec.ts');
    this.description = prompt ?? '';
    this.tooltip = prompt ? `${vscode.workspace.asRelativePath(uri)}\n\n"${prompt}"` : vscode.workspace.asRelativePath(uri);
    this.resourceUri = uri;
    this.iconPath = new vscode.ThemeIcon(isSecurity ? 'shield' : 'beaker');
    this.contextValue = isSecurity ? 'hoverSecuritySpec' : 'hoverSpec';
    this.command = { command: 'vscode.open', title: 'Open Spec', arguments: [uri] };
  }
}

class PlaceholderItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

/** A top-level group ("Tests" / "Security") holding its spec URIs. */
class CategoryItem extends vscode.TreeItem {
  constructor(label: string, icon: string, readonly uris: vscode.Uri[]) {
    super(`${label} (${uris.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'hoverCategory';
  }
}

export class SpecsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    // Second level: a category's specs (read each prompt lazily on expand).
    if (element instanceof CategoryItem) {
      const items: SpecItem[] = [];
      for (const uri of element.uris) {
        let prompt: string | null = null;
        try {
          prompt = extractOriginalPrompt(await vscode.workspace.openTextDocument(uri), 40);
        } catch {
          /* unreadable — show without a prompt */
        }
        items.push(new SpecItem(uri, prompt));
      }
      return items;
    }
    if (element) return [];

    // Top level: partition specs into Tests vs Security so the extension's two
    // capabilities are visible in the tree.
    if (!vscode.workspace.workspaceFolders?.length) {
      return [new PlaceholderItem('Open a project folder to see its specs.')];
    }
    const uris = await vscode.workspace.findFiles('**/__vibe_tests__/**/*.spec.ts', '**/node_modules/**');
    if (uris.length === 0) return []; // viewsWelcome takes over

    uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const security = uris.filter((u) => u.fsPath.endsWith('.security.spec.ts'));
    const tests = uris.filter((u) => !u.fsPath.endsWith('.security.spec.ts'));
    const groups: vscode.TreeItem[] = [];
    if (tests.length) groups.push(new CategoryItem('Tests', 'beaker', tests));
    if (security.length) groups.push(new CategoryItem('Security', 'shield', security));
    return groups;
  }
}

/**
 * Register the specs view + a refresh command + a file watcher that keeps it
 * live. Returns disposables for the extension to own.
 */
export function registerSpecsView(): vscode.Disposable[] {
  const provider = new SpecsTreeProvider();
  const view = vscode.window.createTreeView('hover.specs', { treeDataProvider: provider });
  const refresh = vscode.commands.registerCommand('hover.refreshSpecs', () => provider.refresh());

  const watcher = vscode.workspace.createFileSystemWatcher('**/__vibe_tests__/**/*.spec.ts');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  watcher.onDidChange(() => provider.refresh());

  return [view, refresh, watcher];
}
