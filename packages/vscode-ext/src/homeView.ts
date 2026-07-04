/**
 * The single Hover panel — one webview under the Hover Activity Bar icon, with
 * tabs (Overview / Heal / Environments / Map). It replaces the three separate
 * sidebar views; think of it as a miniature Hover Cloud in the editor, gated on
 * sign-in.
 *
 * Signed OUT → the webview shows only a sign-in screen (the panel is a Cloud
 * client). Signed IN → this provider gathers a combined payload and pushes it:
 *   - dashboard  — Local (`.hover/runs`) or Remote (Cloud `/api/v1/dashboard`),
 *                  toggled by the user (state kept in workspaceState).
 *   - heal       — this repo's open heal queue from Cloud; click copies the
 *                  `/mcp__hover__heal <slug>` command for the user's agent.
 *   - environments — the roster + account presence (commands live in
 *                  environmentsView.ts; the tab's buttons run them).
 *   - map        — a coverage summary; the full graph opens in an editor panel.
 *
 * All heavy sources are bounded + cached in their own modules; this provider
 * just orchestrates + debounces refreshes.
 */
import * as vscode from 'vscode';
import {
  DEFAULT_CLOUD_URL,
  fetchHealRequests,
  fetchProjects,
  healSlug,
  readCloudCredentials,
  type CloudHealRequest,
} from '@hover-dev/core/cloud';
import type { DashboardData } from '@hover-dev/core/dashboard';
import { renderWebviewHtml } from './webviewHost.js';
import {
  CLOUD_TTL_MS,
  cloudState,
  gatherLocalDashboard,
  gatherRemoteDashboard,
  invalidateRemoteCache,
} from './dashboardView.js';
import { gatherMapSummary } from './businessMapView.js';
import { serializeEnvironments, type EnvVM } from './environmentsView.js';
import { originRepo } from './githubCi.js';
import type { EnvironmentStore } from './environments.js';

type Source = 'local' | 'remote';
const SOURCE_KEY = 'hover.dashboardSource';
// A per-workspace override for which Cloud project (owner/name) this checkout
// maps to — set via the project picker when git-remote detection misses.
const REPO_KEY = 'hover.repoOverride';
const CLOUD_TIMEOUT_MS = 8_000;

interface HealVM {
  id: string;
  specFile: string;
  slug: string;
  status: CloudHealRequest['status'];
  branch: string | null;
  environment: string | null;
  ciUrl: string | null;
}

interface HomePayload {
  type: 'data';
  cloud: ReturnType<typeof cloudState>;
  /** The Cloud project (owner/name) this workspace maps to; null when unknown. */
  repo: string | null;
  source: Source;
  remoteAvailable: boolean;
  dashboard: DashboardData;
  environments: EnvVM[];
  map: { exists: boolean; app?: string; stats?: { lines: number; covered: number; areas: number } };
  heal: HealVM[];
}

// Cache the heal queue like the remote dashboard — bounded + TTL'd, keyed by
// repo so a project switch can't serve another repo's queue.
let healCache: { at: number; repo: string; items: HealVM[] } | undefined;

/** The open heal queue for a SPECIFIC repo. `repo` must be resolved by the
 *  caller — passing undefined returns [] rather than every project's queue
 *  (the bug that showed one repo another project's heal requests). */
async function gatherHeal(repo: string | undefined, force = false): Promise<HealVM[]> {
  if (!repo) return [];
  if (!force && healCache && healCache.repo === repo && Date.now() - healCache.at < CLOUD_TTL_MS) {
    return healCache.items;
  }
  const items = await (async (): Promise<HealVM[]> => {
    const creds = readCloudCredentials();
    if (!creds) return [];
    try {
      const rows = await fetchHealRequests(
        creds,
        { status: 'open', repo },
        (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) }),
      );
      return rows.map((r) => ({
        id: r.id,
        specFile: r.specFile,
        slug: healSlug(r.specFile),
        status: r.status,
        branch: r.run?.branch ?? null,
        environment: r.run?.environment ?? null,
        ciUrl: r.run?.ciUrl ?? null,
      }));
    } catch {
      return [];
    }
  })();
  healCache = { at: Date.now(), repo, items };
  return items;
}

/** The Cloud project this checkout maps to: the manual override if set, else
 *  the GitHub `owner/name` from the git origin remote. Undefined = unknown, and
 *  every cloud gather returns empty rather than leaking another project's data. */
async function resolveRepo(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  const override = ctx.workspaceState.get<string>(REPO_KEY);
  if (override) return override;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  const r = await originRepo(folder.uri.fsPath);
  return r ? `${r.owner}/${r.repo}` : undefined;
}

export class HomeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'hover.home';
  private view?: vscode.WebviewView;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: EnvironmentStore,
    private readonly context: vscode.ExtensionContext,
    private readonly onActiveEnvChange: () => void,
  ) {}

  private get source(): Source {
    return this.context.workspaceState.get<Source>(SOURCE_KEY, 'remote');
  }
  private setSource(s: Source): Thenable<void> {
    return this.context.workspaceState.update(SOURCE_KEY, s);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, 'home');
    view.webview.onDidReceiveMessage((msg: { type: string; [k: string]: unknown }) => this.onMessage(msg));
    // Poll the cloud (CI runs land without touching local files).
    const tick = setInterval(() => {
      if (cloudState().connected) this.refresh();
    }, CLOUD_TTL_MS + 5_000);
    view.onDidDispose(() => clearInterval(tick));
  }

  /** Debounced re-gather + push — a single save fires several watchers. */
  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.push();
    }, 80);
  }

  private async push(force = false): Promise<void> {
    if (!this.view) return;
    const cloud = cloudState();
    // Local-first: Overview·Local / Env / Map always work. Remote + Heal need
    // Cloud, so only fetch those (and resolve the repo) when signed in.
    const repo = cloud.connected ? await resolveRepo(this.context) : undefined;
    const [remote, environments, map, heal] = await Promise.all([
      cloud.connected ? gatherRemoteDashboard(repo, force) : Promise.resolve(null),
      serializeEnvironments(this.store),
      gatherMapSummary(),
      cloud.connected ? gatherHeal(repo, force) : Promise.resolve([] as HealVM[]),
    ]);
    const remoteAvailable = !!remote?.hasRuns;
    // Signed out forces Local; signed in, fall back to Local when Remote is empty.
    const source: Source = !cloud.connected
      ? 'local'
      : this.source === 'remote' && !remoteAvailable
        ? 'local'
        : this.source;
    const dashboard = source === 'remote' && remote ? remote : await gatherLocalDashboard();
    const payload: HomePayload = { type: 'data', cloud, repo: repo ?? null, source, remoteAvailable, dashboard, environments, map, heal };
    void this.view.webview.postMessage(payload);
  }

  private onMessage(msg: { type: string; [k: string]: unknown }): void {
    const path = typeof msg.path === 'string' ? msg.path : undefined;
    const envId = typeof msg.envId === 'string' ? msg.envId : undefined;
    const label = typeof msg.label === 'string' ? msg.label : undefined;
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        invalidateRemoteCache();
        healCache = undefined;
        void this.push(true);
        return;
      case 'setSource':
        if (msg.source === 'local' || msg.source === 'remote') void this.setSource(msg.source).then(() => this.push());
        return;
      case 'runAll':
        void vscode.commands.executeCommand('hover.runAllSpecs');
        return;
      case 'runSpec':
        if (path) void vscode.commands.executeCommand('hover.runSpec', vscode.Uri.file(path));
        return;
      case 'syncCi':
        void vscode.commands.executeCommand('hover.syncCiResults');
        return;
      case 'open':
        if (path) void vscode.window.showTextDocument(vscode.Uri.file(path));
        return;
      case 'openUrl':
        if (typeof msg.url === 'string') void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        return;
      case 'addCiWorkflow':
        void vscode.commands.executeCommand('hover.addCiWorkflow');
        return;
      case 'installMcp':
        void vscode.commands.executeCommand('hover.installMcp');
        return;
      case 'openSite':
        void vscode.commands.executeCommand('hover.openSite');
        return;
      case 'connectCloud':
        void vscode.commands.executeCommand('hover.connectCloud');
        return;
      case 'disconnectCloud':
        void vscode.commands.executeCommand('hover.disconnectCloud');
        return;
      case 'openCloud': {
        const url = (readCloudCredentials()?.url ?? DEFAULT_CLOUD_URL).replace(/\/$/, '');
        void vscode.env.openExternal(vscode.Uri.parse(`${url}/dashboard`));
        return;
      }
      case 'openMap':
        void vscode.commands.executeCommand('hover.openBusinessMap');
        return;
      case 'pickRepo':
        void this.pickRepo();
        return;
      case 'copyTestApp':
        void copyCmd('/mcp__hover__test_app', 'map + test your app');
        return;
      case 'copyHeal':
        if (typeof msg.slug === 'string') void copyCmd(`/mcp__hover__heal ${msg.slug}`, 'heal this spec');
        return;
      case 'envAdd':
        void vscode.commands.executeCommand('hover.env.add');
        return;
      case 'envSetActive':
        void vscode.commands.executeCommand('hover.env.setActive', { envId });
        this.onActiveEnvChange();
        return;
      case 'envEditUrl':
        void vscode.commands.executeCommand('hover.env.editUrl', { envId });
        return;
      case 'envRemove':
        void vscode.commands.executeCommand('hover.env.remove', { envId });
        return;
      case 'envExport':
        void vscode.commands.executeCommand('hover.env.exportEnv', { envId });
        return;
      case 'envAddAccount':
        void vscode.commands.executeCommand('hover.env.addAccount', { envId });
        return;
      case 'envSetPassword':
        void vscode.commands.executeCommand('hover.env.setPassword', { envId, label });
        return;
      case 'envRemoveAccount':
        void vscode.commands.executeCommand('hover.env.removeAccount', { envId, label });
        return;
    }
  }

  /** Manual project selection — for when git-remote auto-detection misses (a
   *  fork, a rename, a monorepo). Lists the user's Cloud projects; the choice
   *  is stored per-workspace and overrides detection. "Auto-detect" clears it. */
  private async pickRepo(): Promise<void> {
    const creds = readCloudCredentials();
    if (!creds) return;
    let projects;
    try {
      projects = await fetchProjects(creds, (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) }),
      );
    } catch {
      void vscode.window.showErrorMessage("Hover: couldn't load your Hover Cloud projects.");
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const detected = folder ? await originRepo(folder.uri.fsPath) : null;
    const detectedRepo = detected ? `${detected.owner}/${detected.repo}` : undefined;
    const items: (vscode.QuickPickItem & { repo?: string; auto?: boolean })[] = [
      { label: '$(sync) Auto-detect from git remote', description: detectedRepo ?? 'no GitHub origin remote', auto: true },
      ...(projects.length ? [{ label: 'Your projects', kind: vscode.QuickPickItemKind.Separator }] : []),
      ...projects.map((p) => ({ label: p.repo, description: `${p.name} · ${p.org}`, repo: p.repo })),
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: 'Hover: which Cloud project is this workspace?',
      placeHolder: projects.length ? 'Pick a project, or auto-detect from git' : 'No projects yet — create one at cloud.gethover.dev',
    });
    if (!pick) return;
    await this.context.workspaceState.update(REPO_KEY, pick.auto ? undefined : pick.repo);
    invalidateRemoteCache();
    healCache = undefined;
    this.refresh();
  }
}

async function copyCmd(cmd: string, what: string): Promise<void> {
  await vscode.env.clipboard.writeText(cmd);
  void vscode.window.showInformationMessage(
    `Hover: copied "${cmd}" — paste it into your coding agent (Claude Code) to ${what}.`,
  );
}

/** Register the single Hover panel + a debounced watcher over `.hover/` + specs
 *  so the panel stays live. Returns disposables. */
export function registerHomeView(
  extensionUri: vscode.Uri,
  store: EnvironmentStore,
  context: vscode.ExtensionContext,
  onActiveEnvChange: () => void,
): { provider: HomeViewProvider; disposables: vscode.Disposable[] } {
  const provider = new HomeViewProvider(extensionUri, store, context, onActiveEnvChange);
  const view = vscode.window.registerWebviewViewProvider(HomeViewProvider.viewId, provider, {
    webviewOptions: { retainContextWhenHidden: true },
  });
  const refresh = vscode.commands.registerCommand('hover.refreshDashboard', () => {
    invalidateRemoteCache();
    provider.refresh();
  });
  const watcher = vscode.workspace.createFileSystemWatcher('**/.hover/{runs/*.json,conversations/**}');
  watcher.onDidCreate(() => provider.refresh());
  watcher.onDidChange(() => provider.refresh());
  watcher.onDidDelete(() => provider.refresh());
  const specs = vscode.workspace.createFileSystemWatcher('**/__vibe_tests__/**/*.spec.ts');
  specs.onDidCreate(() => provider.refresh());
  specs.onDidDelete(() => provider.refresh());
  return { provider, disposables: [view, refresh, watcher, specs] };
}
