/**
 * The "Environments" sidebar view — a native TreeView listing the test
 * environments (Local + any verified domains the user configures) and the test
 * accounts under each. Sits alongside Specs / Sessions.
 *
 * This is the local-only first cut: you add environments + accounts here, pick
 * the active one (drives the run target URL), and store account passwords in
 * SecretStorage. Cloud-backed rows (real DNS-TXT domain verification, account
 * sync) render as dimmed, command-less placeholders — visibly present but
 * non-clickable until Hover Cloud ships.
 *
 * `EnvironmentStore` owns persistence; this file owns the tree + the commands.
 */
import * as vscode from 'vscode';
import { EnvironmentStore, LOCAL_ENV_ID, type HoverEnvironment, type HoverAccount } from './environments.js';

/** A test environment row (Local / Staging / …). */
class EnvironmentItem extends vscode.TreeItem {
  constructor(readonly env: HoverEnvironment, readonly active: boolean) {
    super(env.name, env.accounts.length ? (active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
    const host = env.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const badge = env.id === LOCAL_ENV_ID ? '' : env.verified ? '  ✓' : '  ⚠';
    this.description = host + badge;
    this.tooltip = `${env.name} — ${env.url}${
      env.id === LOCAL_ENV_ID ? '' : env.verified ? '\nDomain verified.' : '\nDomain not verified (verification arrives with Hover Cloud).'
    }${active ? '\n\nActive run target.' : '\n\nClick to make this the active run target.'}`;
    this.iconPath = new vscode.ThemeIcon(
      active ? 'circle-large-filled' : 'circle-large-outline',
      active ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.contextValue = env.id === LOCAL_ENV_ID ? 'hoverEnvLocal' : env.verified ? 'hoverEnv' : 'hoverEnvUnverified';
    this.command = { command: 'hover.env.setActive', title: 'Set active', arguments: [this] };
  }
}

/** A test account under an environment. */
class AccountItem extends vscode.TreeItem {
  constructor(readonly envId: string, readonly account: HoverAccount, readonly hasPassword: boolean) {
    super(account.label, vscode.TreeItemCollapsibleState.None);
    const base = [account.role, account.username].filter(Boolean).join(' · ');
    this.description = (base ? base + '  ' : '') + (hasPassword ? '🔑' : '⚠ no password');
    this.tooltip = `Account "${account.label}"${account.username ? ` (${account.username})` : ''}\n${
      hasPassword
        ? 'Password stored in SecretStorage — never written to a spec.'
        : 'No password stored. Use "Set / Update Password" so the agent can log in.'
    }`;
    this.iconPath = new vscode.ThemeIcon('account');
    this.contextValue = 'hoverAccount';
  }
}

/** A dimmed, command-less Cloud placeholder row. */
class CloudPlaceholderItem extends vscode.TreeItem {
  constructor(label: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = 'Hover Cloud';
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('disabledForeground'));
    this.contextValue = 'hoverCloudSoon';
    // No `command` → the row is inert (non-clickable).
  }
}

export class EnvironmentsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: EnvironmentStore) {
    store.onDidChange(() => this.changed.fire());
  }

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof EnvironmentItem) {
      return Promise.all(
        element.env.accounts.map(async (a) =>
          new AccountItem(element.env.id, a, await this.store.hasPassword(element.env.id, a.label)),
        ),
      );
    }
    if (element) return [];

    if (!vscode.workspace.workspaceFolders?.length) {
      const note = new vscode.TreeItem('Open a project folder to configure environments.');
      note.iconPath = new vscode.ThemeIcon('info');
      return [note];
    }
    const envs = await this.store.load();
    const activeId = this.store.getActiveId();
    const items: vscode.TreeItem[] = envs.map((e) => new EnvironmentItem(e, e.id === activeId));
    items.push(
      new CloudPlaceholderItem(
        'Verify a domain',
        'Real DNS-TXT domain ownership verification arrives with Hover Cloud. Until then, add an environment and confirm you own it.',
      ),
      new CloudPlaceholderItem(
        'Sign in to Hover Cloud',
        'Cross-machine sync, team-shared environments, and run dashboards arrive with Hover Cloud.',
      ),
    );
    return items;
  }
}

/**
 * Register the Environments view + all env/account commands + a watcher on the
 * roster file. `onActiveChange` lets the extension refresh the chat header pill
 * and re-probe the target when the active environment changes.
 */
export function registerEnvironmentsView(
  store: EnvironmentStore,
  onActiveChange: () => void,
): vscode.Disposable[] {
  const provider = new EnvironmentsTreeProvider(store);
  const view = vscode.window.createTreeView('hover.environments', { treeDataProvider: provider });

  const disposables: vscode.Disposable[] = [
    view,
    vscode.commands.registerCommand('hover.refreshEnvironments', () => provider.refresh()),

    vscode.commands.registerCommand('hover.env.add', async () => {
      const name = await vscode.window.showInputBox({ title: 'Hover: add environment', prompt: 'Name (e.g. Staging, Prod)' });
      if (!name) return;
      const url = await vscode.window.showInputBox({
        title: `Hover: ${name} URL`,
        prompt: 'Base URL (e.g. https://staging.myapp.com)',
        value: 'https://',
        validateInput: (v) => (/^https?:\/\/.+/.test(v) ? null : 'Enter a full http(s) URL'),
      });
      if (!url) return;
      await store.addEnvironment(name, url);
    }),

    vscode.commands.registerCommand('hover.env.editUrl', async (item?: EnvironmentItem) => {
      if (!(item instanceof EnvironmentItem)) return;
      const url = await vscode.window.showInputBox({
        title: `Hover: ${item.env.name} URL`,
        value: item.env.url,
        validateInput: (v) => (/^https?:\/\/.+/.test(v) ? null : 'Enter a full http(s) URL'),
      });
      if (url === undefined) return;
      await store.updateEnvironmentUrl(item.env.id, url);
      onActiveChange();
    }),

    vscode.commands.registerCommand('hover.env.remove', async (item?: EnvironmentItem) => {
      if (!(item instanceof EnvironmentItem) || item.env.id === LOCAL_ENV_ID) return;
      const ok = await vscode.window.showWarningMessage(
        `Remove environment "${item.env.name}" and its account credentials?`,
        { modal: true },
        'Remove',
      );
      if (ok !== 'Remove') return;
      await store.removeEnvironment(item.env.id);
      onActiveChange();
    }),

    vscode.commands.registerCommand('hover.env.setActive', async (item?: EnvironmentItem) => {
      if (!(item instanceof EnvironmentItem)) return;
      await store.setActiveId(item.env.id);
      onActiveChange();
    }),

    vscode.commands.registerCommand('hover.env.exportEnv', async (item?: EnvironmentItem) => {
      if (!(item instanceof EnvironmentItem)) return;
      const block = await buildEnvBlock(store, item.env);
      if (!block) {
        void vscode.window.showInformationMessage(
          `Hover: ${item.env.name} has no accounts with credentials to export. Add an account + password first.`,
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(clipboard) Copy to clipboard', detail: 'For pasting into CI secrets or a shell', action: 'copy' },
          { label: '$(file) Write to .hover/.env', detail: 'Local dotenv — gitignored; plaintext on disk', action: 'write' },
        ],
        { title: `Hover: export ${item.env.name} env vars` },
      );
      if (pick?.action === 'copy') {
        await vscode.env.clipboard.writeText(block + '\n');
        void vscode.window.showInformationMessage(`Hover: copied ${item.env.name} env vars to the clipboard.`);
      } else if (pick?.action === 'write') {
        await writeEnvFile(block);
      }
    }),

    vscode.commands.registerCommand('hover.env.addAccount', async (item?: EnvironmentItem) => {
      const envId = item instanceof EnvironmentItem ? item.env.id : await pickEnvId(store);
      if (!envId) return;
      const label = await vscode.window.showInputBox({ title: 'Hover: add account', prompt: 'Label the agent / spec references (e.g. paid-user)' });
      if (!label) return;
      const role = await vscode.window.showInputBox({ title: 'Hover: account role (optional)', prompt: 'e.g. admin, free, paid' });
      const username = await vscode.window.showInputBox({ title: 'Hover: username / email (optional)', prompt: 'Login identifier' });
      const password = await vscode.window.showInputBox({ title: 'Hover: password (optional)', prompt: 'Stored in SecretStorage — never written to a spec', password: true });
      await store.addAccount(envId, { label, role: role || undefined, username: username || undefined }, password || undefined);
    }),

    vscode.commands.registerCommand('hover.env.setPassword', async (item?: AccountItem) => {
      if (!(item instanceof AccountItem)) return;
      const password = await vscode.window.showInputBox({
        title: `Hover: password for "${item.account.label}"`,
        prompt: 'Stored in SecretStorage — never written to a spec. Blank to cancel.',
        password: true,
      });
      if (!password) return;
      await store.updatePassword(item.envId, item.account.label, password);
      void vscode.window.showInformationMessage(`Hover: password set for "${item.account.label}".`);
    }),

    vscode.commands.registerCommand('hover.env.removeAccount', async (item?: AccountItem) => {
      if (!(item instanceof AccountItem)) return;
      const ok = await vscode.window.showWarningMessage(
        `Remove account "${item.account.label}"?`,
        { modal: true },
        'Remove',
      );
      if (ok !== 'Remove') return;
      await store.removeAccount(item.envId, item.account.label);
    }),
  ];

  // Keep the tree live when the roster file changes on disk (e.g. git pull).
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.hover/environments.json'),
    );
    watcher.onDidCreate(() => provider.refresh());
    watcher.onDidChange(() => provider.refresh());
    watcher.onDidDelete(() => provider.refresh());
    disposables.push(watcher);
  }

  return disposables;
}

async function pickEnvId(store: EnvironmentStore): Promise<string | undefined> {
  const envs = await store.load();
  const pick = await vscode.window.showQuickPick(
    envs.map((e) => ({ label: e.name, description: e.url, id: e.id })),
    { title: 'Hover: which environment?' },
  );
  return pick?.id;
}

/** A dotenv block for an environment: BASE_URL + each account's USER/PASS.
 *  Returns null if there's nothing with credentials to export. */
async function buildEnvBlock(store: EnvironmentStore, env: HoverEnvironment): Promise<string | null> {
  const entries = await store.accountEnvEntries(env);
  if (!entries.length) return null;
  const lines = [
    `# Hover — ${env.name} test credentials. Plaintext secrets: keep gitignored, never commit.`,
    `BASE_URL=${env.url}`,
    ...entries.map((e) => `${e.name}=${e.value}`),
  ];
  return lines.join('\n');
}

/** Upsert the block's keys into <workspace>/.hover/.env, preserving other keys,
 *  and make sure .hover/.gitignore keeps .env out of git. */
async function writeEnvFile(block: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('Hover: open a project folder first.');
    return;
  }
  const dir = vscode.Uri.joinPath(folder.uri, '.hover');
  const envUri = vscode.Uri.joinPath(dir, '.env');
  await vscode.workspace.fs.createDirectory(dir);

  // Parse existing key=value lines, drop comments/blanks, then upsert ours.
  const merged = new Map<string, string>();
  try {
    const existing = Buffer.from(await vscode.workspace.fs.readFile(envUri)).toString('utf8');
    for (const line of existing.split('\n')) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (m) merged.set(m[1], m[2]);
    }
  } catch {
    /* no existing file */
  }
  let header = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('#')) { header = line; continue; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) merged.set(m[1], m[2]);
  }
  const body = [header, ...[...merged].map(([k, v]) => `${k}=${v}`)].filter(Boolean).join('\n') + '\n';
  await vscode.workspace.fs.writeFile(envUri, Buffer.from(body, 'utf8'));

  // Safety: ensure .env can't be committed regardless of the project's root
  // gitignore policy (in user projects .hover/ is only partly ignored).
  const giUri = vscode.Uri.joinPath(dir, '.gitignore');
  let gi = '';
  try {
    gi = Buffer.from(await vscode.workspace.fs.readFile(giUri)).toString('utf8');
  } catch {
    /* none yet */
  }
  if (!/^\.env\s*$/m.test(gi)) {
    await vscode.workspace.fs.writeFile(giUri, Buffer.from((gi ? gi.replace(/\n*$/, '\n') : '') + '.env\n', 'utf8'));
  }
  void vscode.window.showInformationMessage('Hover: wrote credentials to .hover/.env (gitignored — plaintext, do not commit).');
}
