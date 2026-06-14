/**
 * The Hover sidebar — a native TreeView (no webview) listing the crystallized
 * specs under `__vibe_tests__/`. Native on purpose: the owner wants the
 * extension to look like VSCode, not like the in-page widget (the widget is a
 * layout reference, not a visual-style source).
 *
 * The tree MIRRORS the folder structure under `__vibe_tests__/`: a subfolder
 * becomes a collapsible group, so "creating a group" is just making a folder
 * (e.g. `__vibe_tests__/auth/`, `__vibe_tests__/checkout/`). Specs that live
 * directly in `__vibe_tests__/` sit flat at the top level. Each spec shows its
 * filename + the stamped `Original prompt:` as the row description; security
 * specs (`*.security.spec.ts`) get a distinct shield icon. Click → open the
 * file. The list auto-refreshes when specs are added/removed/moved.
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

/** A folder group (a subfolder of `__vibe_tests__/`) holding the spec URIs
 *  beneath it. `depth` is how many segments deep this folder sits below
 *  `__vibe_tests__/`, so children can be partitioned into "specs at this level"
 *  vs "deeper subfolders". */
class FolderItem extends vscode.TreeItem {
  constructor(label: string, readonly uris: vscode.Uri[], readonly depth: number) {
    super(`${label} (${uris.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'hoverFolder';
  }
}

/** Path segments between the nearest `__vibe_tests__` ancestor and the file,
 *  excluding the filename. `__vibe_tests__/login.spec.ts` → [];
 *  `__vibe_tests__/auth/login.spec.ts` → ['auth']. */
function specSegments(uri: vscode.Uri): string[] {
  const parts = uri.fsPath.split(path.sep);
  const idx = parts.lastIndexOf('__vibe_tests__');
  return idx >= 0 ? parts.slice(idx + 1, -1) : [];
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
    if (element instanceof FolderItem) return this.buildLevel(element.uris, element.depth);
    if (element) return [];

    if (!vscode.workspace.workspaceFolders?.length) {
      return [new PlaceholderItem('Open a project folder to see its specs.')];
    }
    const uris = await vscode.workspace.findFiles('**/__vibe_tests__/**/*.spec.ts', '**/node_modules/**');
    if (uris.length === 0) return []; // viewsWelcome takes over
    return this.buildLevel(uris, 0);
  }

  /** One tree level: subfolders (grouped by the segment at `depth`) first,
   *  then the specs that live directly at this level — both alpha-sorted. */
  private async buildLevel(uris: vscode.Uri[], depth: number): Promise<vscode.TreeItem[]> {
    const byFolder = new Map<string, vscode.Uri[]>();
    const here: vscode.Uri[] = [];
    for (const uri of uris) {
      const segs = specSegments(uri);
      if (segs.length <= depth) {
        here.push(uri);
      } else {
        const name = segs[depth];
        const bucket = byFolder.get(name);
        if (bucket) bucket.push(uri);
        else byFolder.set(name, [uri]);
      }
    }

    const folders = [...byFolder.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, group]) => new FolderItem(name, group, depth + 1));

    here.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const specs: SpecItem[] = [];
    for (const uri of here) {
      let prompt: string | null = null;
      try {
        prompt = extractOriginalPrompt(await vscode.workspace.openTextDocument(uri), 40);
      } catch {
        /* unreadable — show without a prompt */
      }
      specs.push(new SpecItem(uri, prompt));
    }

    return [...folders, ...specs];
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
