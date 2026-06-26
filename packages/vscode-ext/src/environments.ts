/**
 * Environment + test-account store for the "Environments" sidebar view.
 *
 * Three storage layers, by sensitivity:
 *   • The roster (environments + account labels/roles/usernames) lives in
 *     `.hover/environments.json` — commit-worthy, so a team shares one set of
 *     environment definitions that follow the repo.
 *   • Account passwords live in VSCode SecretStorage (per-user, never committed,
 *     never in a spec).
 *   • The active environment id lives in workspaceState (a per-machine choice).
 *
 * `local` is always present (seeded on first load). For the `local` env the
 * effective run target prefers the auto-detected / configured dev URL so the
 * existing zero-config localhost flow is untouched; other environments use
 * their stored URL verbatim.
 *
 * Cloud-backed pieces (real DNS-TXT domain verification, cross-machine sync)
 * are deliberately NOT implemented here — the view shows them as disabled
 * placeholders until Hover Cloud ships.
 */
import * as vscode from 'vscode';

export const LOCAL_ENV_ID = 'local';

export interface HoverAccount {
  /** Stable label the agent / spec references, e.g. "paid-user". */
  label: string;
  /** Free-text role, e.g. "admin" / "free" — shown in the tree, optional. */
  role?: string;
  /** Login identifier (email / username). The password is in SecretStorage. */
  username?: string;
}

/** How this app resets to a clean starting state (debt-2 reproducible-state-
 *  isolation), discovered by recon and reused by the generated resetState()
 *  helper. tier 1 = client-side resettable (clear storage); 2 = backend-synced,
 *  not client-resettable (affected specs are flagged needs-fixture); 3 = needs an
 *  external setup hook (seed endpoint / fresh account / storageState). */
export interface ResetRecipe {
  tier: 1 | 2 | 3;
  /** Tier 1: localStorage keys that gate the flow state (empty/absent = clear all). */
  storageKeys?: string[];
  /** Tier 3: the user-supplied command or URL to establish a clean state. */
  hook?: string;
  /** Recon confirmed the reset actually returns the app to a clean state. */
  verified?: boolean;
  note?: string;
}

export interface HoverEnvironment {
  id: string;
  name: string;
  url: string;
  /** Domain ownership verified (real verification needs Hover Cloud). */
  verified?: boolean;
  accounts: HoverAccount[];
  /** How to reset this env to a clean start (recon-discovered; see ResetRecipe). */
  resetRecipe?: ResetRecipe;
}

interface EnvironmentsFile {
  environments: HoverEnvironment[];
}

/** An `@label` mention resolved to its credentials + the env-var names a saved
 *  spec reads them from. */
export interface ResolvedAccount {
  label: string;
  role?: string;
  username?: string;
  password?: string;
  userEnvVar: string;
  passEnvVar: string;
}

function defaultLocal(): HoverEnvironment {
  return { id: LOCAL_ENV_ID, name: 'Local', url: 'http://localhost:5173', verified: true, accounts: [] };
}

export class EnvironmentStore {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires whenever environments, accounts, or the active selection change. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private fileUri(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, '.hover', 'environments.json') : undefined;
  }

  /** All environments; always includes `local` first. */
  async load(): Promise<HoverEnvironment[]> {
    const uri = this.fileUri();
    let envs: HoverEnvironment[] = [];
    if (uri) {
      try {
        const buf = await vscode.workspace.fs.readFile(uri);
        const parsed = JSON.parse(Buffer.from(buf).toString('utf8')) as EnvironmentsFile;
        if (Array.isArray(parsed?.environments)) envs = parsed.environments.filter((e) => e && e.id && e.url);
      } catch {
        /* missing or malformed — fall back to a seeded local env */
      }
    }
    for (const e of envs) if (!Array.isArray(e.accounts)) e.accounts = [];
    if (!envs.some((e) => e.id === LOCAL_ENV_ID)) envs.unshift(defaultLocal());
    // Keep `local` pinned to the top.
    envs.sort((a, b) => (a.id === LOCAL_ENV_ID ? -1 : b.id === LOCAL_ENV_ID ? 1 : 0));
    return envs;
  }

  async save(envs: HoverEnvironment[]): Promise<void> {
    const uri = this.fileUri();
    if (!uri) return;
    const body = JSON.stringify({ environments: envs } satisfies EnvironmentsFile, null, 2);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(body, 'utf8'));
    this.changed.fire();
  }

  async addEnvironment(name: string, url: string): Promise<void> {
    const envs = await this.load();
    const id = slugify(name) || `env-${envs.length}`;
    if (envs.some((e) => e.id === id)) {
      void vscode.window.showWarningMessage(`Hover: an environment named "${name}" already exists.`);
      return;
    }
    envs.push({ id, name, url, verified: false, accounts: [] });
    await this.save(envs);
  }

  async updateEnvironmentUrl(id: string, url: string): Promise<void> {
    const envs = await this.load();
    const env = envs.find((e) => e.id === id);
    if (!env) return;
    env.url = url;
    if (id !== LOCAL_ENV_ID) env.verified = false; // url changed → re-verify
    await this.save(envs);
  }

  async removeEnvironment(id: string): Promise<void> {
    if (id === LOCAL_ENV_ID) return; // local is built-in
    const envs = await this.load();
    const env = envs.find((e) => e.id === id);
    if (env) for (const a of env.accounts) await this.deletePassword(id, a.label);
    await this.save(envs.filter((e) => e.id !== id));
    if (this.getActiveId() === id) await this.setActiveId(LOCAL_ENV_ID);
  }

  async addAccount(envId: string, account: HoverAccount, password?: string): Promise<void> {
    const envs = await this.load();
    const env = envs.find((e) => e.id === envId);
    if (!env) return;
    if (env.accounts.some((a) => a.label === account.label)) {
      void vscode.window.showWarningMessage(`Hover: account "${account.label}" already exists in ${env.name}.`);
      return;
    }
    env.accounts.push(account);
    if (password) await this.setPassword(envId, account.label, password);
    await this.save(envs);
  }

  /** Persist a recon-discovered reset recipe onto an env (debt-2). Keyed to the
   *  env because reset differs guest-vs-logged-in. Best-effort like addAccount. */
  async setResetRecipe(envId: string, recipe: ResetRecipe): Promise<void> {
    const envs = await this.load();
    const env = envs.find((e) => e.id === envId);
    if (!env) return;
    env.resetRecipe = recipe;
    await this.save(envs);
  }

  async removeAccount(envId: string, label: string): Promise<void> {
    const envs = await this.load();
    const env = envs.find((e) => e.id === envId);
    if (!env) return;
    env.accounts = env.accounts.filter((a) => a.label !== label);
    await this.deletePassword(envId, label);
    await this.save(envs);
  }

  // ── active selection ──────────────────────────────────────────────────────
  getActiveId(): string {
    return this.context.workspaceState.get<string>('hover.activeEnvId', LOCAL_ENV_ID);
  }

  async setActiveId(id: string): Promise<void> {
    await this.context.workspaceState.update('hover.activeEnvId', id);
    this.changed.fire();
  }

  async getActive(): Promise<HoverEnvironment | undefined> {
    const envs = await this.load();
    return envs.find((e) => e.id === this.getActiveId()) ?? envs.find((e) => e.id === LOCAL_ENV_ID);
  }

  // ── account passwords (SecretStorage) ──────────────────────────────────────
  private secretKey(envId: string, label: string): string {
    return `hover.account.${envId}.${label}`;
  }
  setPassword(envId: string, label: string, password: string): Thenable<void> {
    return this.context.secrets.store(this.secretKey(envId, label), password);
  }
  async getPassword(envId: string, label: string): Promise<string | undefined> {
    return (await this.context.secrets.get(this.secretKey(envId, label))) ?? undefined;
  }
  async hasPassword(envId: string, label: string): Promise<boolean> {
    return Boolean(await this.context.secrets.get(this.secretKey(envId, label)));
  }

  /** Resolve `@label` mentions in a prompt against the active environment's
   *  accounts. Returns the matched accounts WITH credentials (username from the
   *  roster, password from SecretStorage) plus the env-var names a saved spec
   *  will read. Used to (a) hand the agent creds to log in, and (b) build the
   *  redactions that keep those creds out of the spec. */
  async resolveMentions(text: string): Promise<ResolvedAccount[]> {
    const active = await this.getActive();
    if (!active || !active.accounts.length) return [];
    const mentioned = new Set<string>();
    for (const m of text.matchAll(/@([A-Za-z0-9_-]+)/g)) mentioned.add(m[1]);
    if (!mentioned.size) return [];
    const out: ResolvedAccount[] = [];
    for (const a of active.accounts) {
      if (!mentioned.has(a.label)) continue;
      out.push({
        label: a.label,
        role: a.role,
        username: a.username,
        password: await this.getPassword(active.id, a.label),
        userEnvVar: accountEnvVar(a.label, 'USER'),
        passEnvVar: accountEnvVar(a.label, 'PASS'),
      });
    }
    return out;
  }

  /** The `NAME=value` env entries for an environment's accounts (passwords read
   *  from SecretStorage). Drives the "export env vars" actions; the values are
   *  exactly what a crystallized spec reads via process.env. */
  async accountEnvEntries(env: HoverEnvironment): Promise<{ name: string; value: string }[]> {
    const out: { name: string; value: string }[] = [];
    for (const a of env.accounts) {
      if (a.username) out.push({ name: accountEnvVar(a.label, 'USER'), value: a.username });
      const pw = await this.getPassword(env.id, a.label);
      if (pw) out.push({ name: accountEnvVar(a.label, 'PASS'), value: pw });
    }
    return out;
  }
  /** Set/update an existing account's password (fires onDidChange so the tree
   *  refreshes its 🔑 indicator). */
  async updatePassword(envId: string, label: string, password: string): Promise<void> {
    await this.setPassword(envId, label, password);
    this.changed.fire();
  }
  deletePassword(envId: string, label: string): Thenable<void> {
    return this.context.secrets.delete(this.secretKey(envId, label));
  }
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The env-var name a crystallized spec reads for an account credential —
 *  `HOVER_<LABEL>_USER` / `HOVER_<LABEL>_PASS`. The same convention the spec
 *  generator uses, so the extension's "export env vars" matches what specs read. */
export function accountEnvVar(label: string, kind: 'USER' | 'PASS'): string {
  const slug = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `HOVER_${slug}_${kind}`;
}
