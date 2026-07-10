/**
 * Environments — commands + a serializer for the Hover panel's Environments tab.
 *
 * The UI used to be a native TreeView; it now lives as a tab in the single
 * Hover webview (see homeView.ts + webview/views/home). This file keeps the
 * env/account COMMANDS (add / edit URL / remove / set active / export env vars /
 * add / set-password / remove account) — the webview buttons post messages that
 * run them — and exposes `serializeEnvironments()` so the tab can render the
 * roster. Add/edit dialogs stay native `showInputBox` prompts; passwords never
 * leave SecretStorage.
 *
 * Command args are plain ids (`{ envId, label }`) so both the webview and the
 * Command Palette can call them; a missing id falls back to a quick-pick.
 */
import * as vscode from 'vscode';
import { detectRepo, pushCredential, readCloudCredentials, type CloudCredentials } from '@hover-dev/core/cloud';
import { EnvironmentStore, LOCAL_ENV_ID } from './environments.js';

/** Signed in + a detectable repo → the target for account Cloud-sync; else null. */
async function cloudSyncTarget(): Promise<{ creds: CloudCredentials; repo: string } | null> {
  const creds = readCloudCredentials();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!creds || !root) return null;
  const repo = detectRepo(root);
  return repo ? { creds, repo } : null;
}

/** One account as the Environments tab renders it (no secrets — just presence). */
export interface EnvAccountVM {
  label: string;
  email?: string;
  hasPassword: boolean;
}

/** One environment as the Environments tab renders it. */
export interface EnvVM {
  id: string;
  name: string;
  url: string;
  verified?: boolean;
  isLocal: boolean;
  active: boolean;
  accounts: EnvAccountVM[];
}

/** The roster + active selection + per-account password presence, for the tab. */
export async function serializeEnvironments(store: EnvironmentStore): Promise<EnvVM[]> {
  const envs = await store.load();
  const activeId = store.getActiveId();
  return Promise.all(
    envs.map(async (e) => ({
      id: e.id,
      name: e.name,
      url: e.url,
      verified: e.verified,
      isLocal: e.id === LOCAL_ENV_ID,
      active: e.id === activeId,
      accounts: await Promise.all(
        e.accounts.map(async (a) => ({
          label: a.label,
          email: a.email,
          hasPassword: await store.hasPassword(e.id, a.label),
        })),
      ),
    })),
  );
}

type EnvArg = { envId?: string; label?: string } | undefined;

/**
 * Register every env/account command + a watcher on the roster file. `onChange`
 * refreshes the Hover panel (and re-probes the target when the active env
 * changes). Returns disposables.
 */
export function registerEnvironmentCommands(
  store: EnvironmentStore,
  onChange: () => void,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [
    vscode.commands.registerCommand('hover.refreshEnvironments', () => onChange()),

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

    vscode.commands.registerCommand('hover.env.editUrl', async (arg?: EnvArg) => {
      const env = await resolveEnv(store, arg);
      if (!env) return;
      const url = await vscode.window.showInputBox({
        title: `Hover: ${env.name} URL`,
        value: env.url,
        validateInput: (v) => (/^https?:\/\/.+/.test(v) ? null : 'Enter a full http(s) URL'),
      });
      if (url === undefined) return;
      await store.updateEnvironmentUrl(env.id, url);
      onChange();
    }),

    vscode.commands.registerCommand('hover.env.remove', async (arg?: EnvArg) => {
      const env = await resolveEnv(store, arg);
      if (!env || env.id === LOCAL_ENV_ID) return;
      const ok = await vscode.window.showWarningMessage(
        `Remove environment "${env.name}" and its account credentials?`,
        { modal: true },
        'Remove',
      );
      if (ok !== 'Remove') return;
      // Snapshot env + passwords BEFORE deleting, so Undo can fully restore.
      const passwords: Record<string, string> = {};
      for (const a of env.accounts) {
        const pw = await store.getPassword(env.id, a.label);
        if (pw) passwords[a.label] = pw;
      }
      const wasActive = store.getActiveId() === env.id;
      await store.removeEnvironment(env.id);
      onChange();
      const undo = await vscode.window.showInformationMessage(`Hover: removed "${env.name}".`, 'Undo');
      if (undo === 'Undo') {
        await store.restoreEnvironment(env, passwords);
        if (wasActive) await store.setActiveId(env.id);
        onChange();
      }
    }),

    vscode.commands.registerCommand('hover.env.setActive', async (arg?: EnvArg) => {
      const env = await resolveEnv(store, arg);
      if (!env) return;
      await store.setActiveId(env.id);
      onChange();
    }),

    vscode.commands.registerCommand('hover.env.exportEnv', async (arg?: EnvArg) => {
      const env = await resolveEnv(store, arg);
      if (!env) return;
      const block = await buildEnvBlock(store, env);
      if (!block) {
        void vscode.window.showInformationMessage(
          `Hover: ${env.name} has no accounts with credentials to export. Add an account + password first.`,
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(clipboard) Copy to clipboard', detail: 'For pasting into CI secrets or a shell', action: 'copy' },
          { label: '$(file) Write to .hover/.env', detail: 'Local dotenv — gitignored; plaintext on disk', action: 'write' },
        ],
        { title: `Hover: export ${env.name} env vars` },
      );
      if (pick?.action === 'copy') {
        await vscode.env.clipboard.writeText(block + '\n');
        void vscode.window.showInformationMessage(`Hover: copied ${env.name} env vars to the clipboard.`);
      } else if (pick?.action === 'write') {
        await writeEnvFile(block);
      }
    }),

    // One-click "prepare the active env for the MCP": write its creds to
    // `.hover/.env` (the file the MCP loads for HOVER_<LABEL>_USER/PASS). The
    // env's URL already flows via `.hover/active.json` (kept in sync by onChange).
    vscode.commands.registerCommand('hover.env.syncMcp', async () => {
      const envs = await store.load();
      const active = envs.find((e) => e.id === store.getActiveId()) ?? envs[0];
      if (!active) return;
      const block = await buildEnvBlock(store, active);
      if (!block) {
        void vscode.window.showInformationMessage(
          `Hover: "${active.name}" has no account credentials to export. Add an account + password first, then sync for MCP.`,
        );
        return;
      }
      await writeEnvFile(block);
      onChange(); // re-publish active.json + refresh the panel's MCP-ready hint
    }),

    vscode.commands.registerCommand('hover.env.addAccount', async (arg?: EnvArg) => {
      const envId = arg?.envId ?? (await pickEnvId(store));
      if (!envId) return;
      const label = await vscode.window.showInputBox({ title: 'Hover: add account', prompt: 'Label the agent / spec references (e.g. paid-user)' });
      if (!label) return;
      const email = await vscode.window.showInputBox({ title: 'Hover: login email', prompt: 'The email the agent logs in with' });
      if (!email) return;
      const password = await vscode.window.showInputBox({ title: 'Hover: password', prompt: 'Stored in SecretStorage — never written to a spec', password: true });
      if (!password) return;
      await store.addAccount(envId, { label, email }, password);
      onChange();
    }),

    vscode.commands.registerCommand('hover.env.setPassword', async (arg?: EnvArg) => {
      if (!arg?.envId || !arg.label) return;
      const password = await vscode.window.showInputBox({
        title: `Hover: password for "${arg.label}"`,
        prompt: 'Stored in SecretStorage — never written to a spec. Blank to cancel.',
        password: true,
      });
      if (!password) return;
      await store.updatePassword(arg.envId, arg.label, password);
      onChange();
      // Opt-in Cloud sync: encrypted at rest, lets the MCP log in as this
      // account on any signed-in machine without a local .env export.
      const target = await cloudSyncTarget();
      if (!target) {
        void vscode.window.showInformationMessage(`Hover: password set for "${arg.label}".`);
        return;
      }
      const pick = await vscode.window.showInformationMessage(
        `Hover: password set for "${arg.label}". Sync it to Hover Cloud (encrypted) so the MCP can use it on any signed-in machine?`,
        'Sync to Cloud',
        'Keep local only',
      );
      if (pick !== 'Sync to Cloud') return;
      try {
        const env = (await store.load()).find((e) => e.id === arg.envId);
        const account = env?.accounts.find((a) => a.label === arg.label);
        await pushCredential(target.creds, {
          repo: target.repo,
          environment: env?.name ?? arg.envId,
          label: arg.label,
          email: account?.email,
          user: account?.email,
          pass: password,
        });
        void vscode.window.showInformationMessage(`Hover: "${arg.label}" synced to Cloud (encrypted).`);
      } catch (e) {
        void vscode.window.showWarningMessage(`Hover: Cloud sync failed — ${e instanceof Error ? e.message : e}. The password is still stored locally.`);
      }
    }),

    // Push EVERY local account with a password up to Cloud (encrypted) — the
    // bulk version of the per-password opt-in above.
    vscode.commands.registerCommand('hover.env.syncAccountsToCloud', async () => {
      const target = await cloudSyncTarget();
      if (!target) {
        void vscode.window.showInformationMessage(
          'Hover: sign in to Hover Cloud (and link this repo to a project) first — then accounts can sync.',
        );
        return;
      }
      const envs = await store.load();
      let synced = 0;
      const failed: string[] = [];
      for (const env of envs) {
        for (const account of env.accounts) {
          const pass = await store.getPassword(env.id, account.label);
          if (!pass) continue; // nothing secret to sync
          try {
            await pushCredential(target.creds, {
              repo: target.repo,
              environment: env.name,
              label: account.label,
              email: account.email,
              user: account.email,
              pass,
            });
            synced++;
          } catch (e) {
            failed.push(`${env.name}/${account.label}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      if (failed.length) {
        void vscode.window.showWarningMessage(`Hover: synced ${synced} account(s); failed — ${failed.join('; ')}`);
      } else if (synced) {
        void vscode.window.showInformationMessage(`Hover: synced ${synced} account(s) to Cloud (encrypted).`);
      } else {
        void vscode.window.showInformationMessage('Hover: no accounts with passwords to sync yet.');
      }
    }),

    vscode.commands.registerCommand('hover.env.removeAccount', async (arg?: EnvArg) => {
      if (!arg?.envId || !arg.label) return;
      const ok = await vscode.window.showWarningMessage(
        `Remove account "${arg.label}"?`,
        { modal: true },
        'Remove',
      );
      if (ok !== 'Remove') return;
      // Snapshot account + password so Undo can restore both.
      const env = (await store.load()).find((e) => e.id === arg.envId);
      const account = env?.accounts.find((a) => a.label === arg.label);
      const password = await store.getPassword(arg.envId, arg.label);
      await store.removeAccount(arg.envId, arg.label);
      onChange();
      if (!account) return;
      const undo = await vscode.window.showInformationMessage(`Hover: removed account "${arg.label}".`, 'Undo');
      if (undo === 'Undo') {
        await store.restoreAccount(arg.envId, account, password);
        onChange();
      }
    }),
  ];

  // Keep the panel live when the roster file changes on disk (e.g. git pull).
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.hover/environments.json'),
    );
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    disposables.push(watcher);
  }

  return disposables;
}

/** Resolve an env from a `{envId}` arg, or fall back to a quick-pick. */
async function resolveEnv(store: EnvironmentStore, arg: EnvArg) {
  const envs = await store.load();
  if (arg?.envId) return envs.find((e) => e.id === arg.envId);
  const id = await pickEnvId(store);
  return id ? envs.find((e) => e.id === id) : undefined;
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
async function buildEnvBlock(store: EnvironmentStore, env: { id: string; name: string; url: string }): Promise<string | null> {
  const full = (await store.load()).find((e) => e.id === env.id);
  if (!full) return null;
  const entries = await store.accountEnvEntries(full);
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
