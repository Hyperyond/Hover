/**
 * `hover-dev` — Hover's VSCode extension entry.
 *
 * MCP-first pivot: the extension is a PASSIVE REVIEW COCKPIT. It drives no
 * agent and ships no engine — the user's own coding agent (via the separate
 * Hover MCP server) does all the browser driving and crystallization. This
 * surface only VISUALIZES / reviews the artifacts the agent produces and RUNS
 * the crystallized specs via the user's own Playwright.
 *
 * Surfaces:
 *   • Activity Bar "Hover" → Dashboard (spec×run health + file tree),
 *     Business Map, Environments (Local + remote targets; the active env drives
 *     the run target URL + injects @account creds into runs).
 *   • F1 review optimization candidate · F3 spec CodeLens (provenance + review).
 *   • ▶ Run a spec / folder / all in a terminal (the user's Playwright).
 *   • Sync CI results into the local dashboard + generate a PR CI workflow.
 *   • Start App = spawn the project's dev server in a terminal.
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { SpecLensProvider } from './specLens.js';
import { registerDashboardView } from './dashboardView.js';
import { registerBusinessMapView } from './businessMapView.js';
import { syncCiResults as ghSyncCiResults } from './githubCi.js';
import { EnvironmentStore, LOCAL_ENV_ID, accountEnvVar } from './environments.js';
import { registerEnvironmentsView } from './environmentsView.js';
import { buildWorkflowYaml } from './ciWorkflow.js';
import { candidateUri, uriExists } from './optimized.js';

let extContext: vscode.ExtensionContext | undefined;
/** Test-environment + account store (Local + configured domains). */
let envStore: EnvironmentStore | undefined;
/** Most recent reachable dev URL (configured or auto-detected). */
let detectedUrl: string | null = null;

/** The run target = the active environment's URL. For `local` we keep the
 *  existing zero-config behaviour (configured appUrl, else auto-detected).
 *  Exported so other surfaces (Business Map's "open route") resolve the same
 *  base URL the runner uses. */
export async function resolveTargetUrl(): Promise<string | null> {
  const active = await envStore?.getActive();
  if (!active || active.id === LOCAL_ENV_ID) {
    return vscode.workspace.getConfiguration('hover').get<string>('appUrl') || detectedUrl;
  }
  return active.url;
}

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  envStore = new EnvironmentStore(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('hover.reviewOptimizationCandidate', (arg?: vscode.TreeItem | vscode.Uri) =>
      reviewOptimizationCandidate(arg),
    ),
    vscode.commands.registerCommand('hover.healSpec', (arg?: vscode.TreeItem | vscode.Uri) => healSpec(arg)),
    vscode.commands.registerCommand('hover.runSpec', (item?: vscode.TreeItem | vscode.Uri) => runSpec(item)),
    vscode.commands.registerCommand('hover.runFolderSpecs', (item?: vscode.TreeItem) => runFolderSpecs(item)),
    vscode.commands.registerCommand('hover.runAllSpecs', () => runAllSpecs()),
    vscode.commands.registerCommand('hover.syncCiResults', () => syncCiResults()),
    vscode.commands.registerCommand('hover.addCiWorkflow', () => addCiWorkflow()),
    vscode.commands.registerCommand('hover.startApp', () => startApp()),
    vscode.commands.registerCommand('hover.specs.focus', () =>
      vscode.commands.executeCommand('workbench.view.extension.hover'),
    ),
    vscode.commands.registerCommand('hover.openRepo', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/Hyperyond/Hover')),
    ),
    vscode.commands.registerCommand('hover.openSite', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://www.gethover.dev/')),
    ),
    vscode.commands.registerCommand('hover.installMcp', () => installMcp()),
    vscode.window.onDidCloseTerminal((t) => {
      if (t === devTerminal) devTerminal = undefined;
    }),
    vscode.languages.registerCodeLensProvider(
      { language: 'typescript', scheme: 'file', pattern: '**/*.spec.ts' },
      new SpecLensProvider(),
    ),
  );

  // Sidebar under the Hover Activity Bar container: the native + webview views.
  context.subscriptions.push(
    ...registerDashboardView(context.extensionUri),
    ...registerBusinessMapView(context.extensionUri),
    ...registerEnvironmentsView(envStore, () => {
      void pollAppStatus();
    }),
  );

  // Poll the dev-server status so resolveTargetUrl() can auto-detect a running
  // dev server (auto-probe common ports when no URL is configured).
  void pollAppStatus();
  appStatusTimer = setInterval(() => void pollAppStatus(), 5000);
  context.subscriptions.push({ dispose: () => { if (appStatusTimer) clearInterval(appStatusTimer); } });
}

export function deactivate(): void {
  if (appStatusTimer) clearInterval(appStatusTimer);
}

// ── Install the Hover MCP server into the user's coding agent ───────────────
// Hover is an MCP server; the user's own agent drives. This is the one-click
// on-ramp: register it with Claude Code, or copy the command for other agents.
const MCP_INSTALL_CMD = 'claude mcp add hover -- npx -y @hover-dev/mcp';

async function installMcp(): Promise<void> {
  const RUN = 'Claude Code';
  const COPY = 'Copy command';
  const pick = await vscode.window.showQuickPick(
    [
      { label: `$(terminal) ${RUN}`, description: 'Run `claude mcp add` in a terminal', id: RUN },
      { label: `$(clippy) ${COPY}`, description: MCP_INSTALL_CMD, id: COPY },
    ],
    { title: 'Install the Hover MCP server', placeHolder: 'Add Hover to your coding agent' },
  );
  if (!pick) return;
  if (pick.id === COPY) {
    await vscode.env.clipboard.writeText(MCP_INSTALL_CMD);
    void vscode.window.showInformationMessage('Copied — paste it where your agent registers MCP servers, then reload it.');
    return;
  }
  const term = vscode.window.createTerminal('Hover MCP');
  term.show();
  term.sendText(MCP_INSTALL_CMD);
  void vscode.window.showInformationMessage('Registering the Hover MCP with Claude Code — then run /mcp__hover__test_app.');
}

// ── Dev-server status (target-URL auto-detection) ──────────────────────────
// With no configured URL we auto-probe common dev ports and remember the first
// that responds, so a one-click run knows where the app is.
const COMMON_DEV_URLS = [
  'http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174',
  'http://localhost:4321', 'http://localhost:8080', 'http://localhost:4200',
  'http://localhost:5000', 'http://localhost:8000', 'http://localhost:1420',
];
let appStatusTimer: ReturnType<typeof setInterval> | undefined;
/** Re-entrancy guard: a full local probe sweep can take ~13s (9 × 1.5s) when
 *  nothing responds, longer than the 5s interval — without this, sweeps stack
 *  and race on detectedUrl. */
let appStatusPolling = false;

async function probeUrl(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

async function pollAppStatus(): Promise<void> {
  if (appStatusPolling) return; // a previous sweep is still in flight
  appStatusPolling = true;
  try {
    const active = await envStore?.getActive();
    const isLocal = !active || active.id === LOCAL_ENV_ID;
    if (isLocal) {
      const configured = vscode.workspace.getConfiguration('hover').get<string>('appUrl');
      const candidates = configured ? [configured] : COMMON_DEV_URLS;
      let target: string | null = null;
      for (const u of candidates) {
        if (await probeUrl(u)) { target = u; break; }
      }
      detectedUrl = target ?? (configured || null);
    }
  } finally {
    appStatusPolling = false;
  }
}

// ── Start App: dev server in a terminal ────────────────────────────────────
let devTerminal: vscode.Terminal | undefined;

function detectPackageManager(root: string): string {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  return 'npm';
}

async function pickDevScript(root: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    for (const s of ['dev', 'start', 'serve']) if (scripts[s]) return s;
    const names = Object.keys(scripts);
    if (names.length === 0) return undefined;
    return vscode.window.showQuickPick(names, { title: 'Hover: which script starts your dev server?' });
  } catch {
    return undefined;
  }
}

/** Start the project's dev server in a terminal (passive — no browser launch).
 *  A remote environment has no local dev server to spawn. */
async function startApp(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('Hover: open a project folder first.');
    return;
  }
  const active = await envStore?.getActive();
  if (active && active.id !== LOCAL_ENV_ID) {
    void vscode.window.showInformationMessage(
      `Hover: "${active.name}" is a remote environment (${active.url}) — no local dev server to start.`,
    );
    return;
  }
  if (devTerminal) {
    devTerminal.show(true);
    return;
  }
  const script = await pickDevScript(root);
  if (!script) {
    void vscode.window.showWarningMessage('Hover: no dev script found in package.json.');
    return;
  }
  const pm = detectPackageManager(root);
  devTerminal = vscode.window.createTerminal({ name: 'Hover Dev Server', cwd: root });
  devTerminal.show(true);
  devTerminal.sendText(`${pm} run ${script}`);
}

/**
 * F1 — open `vscode.diff` between a spec and its optimization candidate.
 */
async function reviewOptimizationCandidate(arg?: vscode.TreeItem | vscode.Uri): Promise<void> {
  const specUri =
    arg instanceof vscode.Uri ? arg : (arg?.resourceUri ?? vscode.window.activeTextEditor?.document.uri);
  if (!specUri || specUri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Hover: open a spec file to review its optimization candidate.');
    return;
  }
  const candidate = candidateUri(specUri);
  if (!candidate) {
    void vscode.window.showWarningMessage('Hover: the spec is not inside an open workspace folder.');
    return;
  }
  const fileName = path.basename(specUri.fsPath);
  if (!(await uriExists(candidate))) {
    void vscode.window.showInformationMessage(
      `Hover: no optimization candidate for ${fileName} yet.`,
    );
    return;
  }
  await vscode.commands.executeCommand(
    'vscode.diff',
    specUri,
    candidate,
    `Hover · ${fileName} ↔ optimized`,
    { preview: true } satisfies vscode.TextDocumentShowOptions,
  );
}

/** Hand self-heal off to the user's coding agent. The cockpit drives no agent,
 *  so copy the `/mcp__hover__heal <slug>` command for the user to run in Claude
 *  Code, where the Hover MCP replays the spec and re-grounds the drifted step. */
async function healSpec(arg?: vscode.TreeItem | vscode.Uri): Promise<void> {
  const specUri =
    arg instanceof vscode.Uri ? arg : (arg?.resourceUri ?? vscode.window.activeTextEditor?.document.uri);
  if (!specUri || specUri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Hover: open a spec file to heal it.');
    return;
  }
  const slug = path.basename(specUri.fsPath).replace(/\.spec\.ts$/, '');
  const cmd = `/mcp__hover__heal ${slug}`;
  await vscode.env.clipboard.writeText(cmd);
  void vscode.window.showInformationMessage(
    `Hover: copied "${cmd}" — paste it into your coding agent (Claude Code) to replay & heal this spec. The cockpit reviews; the Hover MCP does the healing.`,
  );
}

/** Run a single spec (inline ▶ on a spec row, or the active spec editor). */
async function runSpec(arg?: vscode.TreeItem | vscode.Uri): Promise<void> {
  const uri = resolveSpecUri(arg);
  if (!uri || uri.scheme !== 'file' || !/\.spec\.ts$/.test(uri.fsPath)) {
    void vscode.window.showWarningMessage('Hover: open or select a spec to run.');
    return;
  }
  await runPlaywright([uri], path.basename(uri.fsPath));
}

/** Run every spec in a folder group (inline ▶ on a `__vibe_tests__` subfolder). */
async function runFolderSpecs(arg?: vscode.TreeItem): Promise<void> {
  const uris = (arg as { uris?: vscode.Uri[] } | undefined)?.uris;
  if (!uris?.length) {
    void vscode.window.showWarningMessage('Hover: no specs in this group.');
    return;
  }
  const label = typeof arg?.label === 'string' ? arg.label.replace(/\s*\(\d+\)\s*$/, '') : 'group';
  await runPlaywright(uris, label);
}

/** Run the whole crystallized suite (▶ in the Dashboard title). */
async function runAllSpecs(): Promise<void> {
  await runPlaywright([], 'all specs');
}

/**
 * Drive the user's own Playwright runner in a terminal — we delegate rather
 * than reimplement a test explorer (the official Playwright extension owns
 * that, design non-goal N1). `uris` empty = the whole suite.
 *
 * Three things make a one-click run trustworthy:
 *   1. Refuse (and offer to install) if @playwright/test isn't in the project,
 *      so the run can't silently no-op.
 *   2. Pass the active environment's URL as PLAYWRIGHT_BASE_URL (best-effort —
 *      the project's playwright.config must read it to honor a remote target;
 *      Local works via the config's own baseURL/webServer regardless).
 *   3. Inject the active env's @account credentials (HOVER_<LABEL>_USER/PASS,
 *      passwords from SecretStorage) so login specs can authenticate.
 * Results are written to `.hover/runs/<ts>.json` (Playwright's json reporter)
 * — the structured record the local dashboard reads.
 */
async function runPlaywright(uris: vscode.Uri[], label: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('Hover: open a project folder first.');
    return;
  }
  const root = folder.uri.fsPath;

  if (!existsSync(path.join(root, 'node_modules', '@playwright', 'test'))) {
    const pick = await vscode.window.showWarningMessage(
      "Playwright isn't installed in this project — specs can't run.",
      'Install Playwright',
      'Cancel',
    );
    if (pick === 'Install Playwright') {
      const t = vscode.window.createTerminal({ name: 'Hover · Playwright setup', cwd: root });
      t.show();
      t.sendText(`${detectPackageManager(root)} add -D @playwright/test && npx playwright install chromium`);
    }
    return;
  }

  const env: Record<string, string> = {};
  const url = await resolveTargetUrl();
  if (url) env.PLAYWRIGHT_BASE_URL = url;
  const activeEnv = await envStore?.getActive();
  if (activeEnv) for (const e of await envStore!.accountEnvEntries(activeEnv)) env[e.name] = e.value;

  const runsDir = path.join(root, '.hover', 'runs');
  try {
    mkdirSync(runsDir, { recursive: true });
  } catch {
    /* best-effort — the run still works, just no dashboard record */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = path.join(runsDir, `${stamp}.json`);

  const terminal = vscode.window.createTerminal({ name: `Hover · Test (${label})`, cwd: root, env });
  terminal.show();
  const files = uris.map((u) => JSON.stringify(path.relative(root, u.fsPath))).join(' ');
  terminal.sendText(`npx playwright test ${files} --reporter=list,json`.replace(/\s+/g, ' ').trim());
}

/** Generate a GitHub Actions workflow that runs the crystallized specs on every
 *  PR — deterministic, no AI. Wires test-account credentials as GitHub secrets
 *  reusing the same HOVER_<LABEL>_* names the Environments export emits. */
async function addCiWorkflow(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('Hover: open a project folder first.');
    return;
  }
  const root = folder.uri.fsPath;
  const packageManager = detectPackageManager(root);
  const devScript = (await pickDevScript(root)) ?? 'dev';
  const appUrl = (await resolveTargetUrl()) ?? 'http://localhost:5173';

  const envs = (await envStore?.load()) ?? [];
  const secretSet = new Set<string>();
  for (const e of envs) {
    for (const a of e.accounts) {
      secretSet.add(accountEnvVar(a.label, 'USER'));
      secretSet.add(accountEnvVar(a.label, 'PASS'));
    }
  }
  const secretNames = [...secretSet];
  const yaml = buildWorkflowYaml({ packageManager, devScript, appUrl, secretNames });

  const fileUri = vscode.Uri.joinPath(folder.uri, '.github', 'workflows', 'hover-e2e.yml');
  try {
    await vscode.workspace.fs.stat(fileUri);
    const ow = await vscode.window.showWarningMessage(
      'Hover: .github/workflows/hover-e2e.yml already exists. Overwrite it?',
      { modal: true },
      'Overwrite',
    );
    if (ow !== 'Overwrite') return;
  } catch {
    /* doesn't exist yet */
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.github', 'workflows'));
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(yaml, 'utf8'));
  await vscode.window.showTextDocument(fileUri);

  if (secretNames.length) {
    const pick = await vscode.window.showInformationMessage(
      `Hover: wrote .github/workflows/hover-e2e.yml. Add these GitHub repo secrets so the specs can log in: ${secretNames.join(', ')}`,
      'Copy secret names',
    );
    if (pick === 'Copy secret names') await vscode.env.clipboard.writeText(secretNames.join('\n'));
  } else {
    void vscode.window.showInformationMessage(
      'Hover: wrote .github/workflows/hover-e2e.yml. Add test accounts in the Environments view if your specs need to log in.',
    );
  }
}

function resolveSpecUri(arg?: vscode.TreeItem | vscode.Uri): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  return arg?.resourceUri ?? vscode.window.activeTextEditor?.document.uri;
}

/** Pull the latest GitHub CI run's Playwright results into `.hover/runs/` so the
 *  Dashboard shows CI failures (cloudless — extension ↔ GitHub). */
async function syncCiResults(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { void vscode.window.showWarningMessage('Hover: open a workspace folder first.'); return; }
  try {
    const res = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Hover: syncing CI results from GitHub…' },
      () => ghSyncCiResults(folder.uri),
    );
    if (!res) {
      void vscode.window.showInformationMessage('Hover: no completed "Hover E2E" run with results yet. Add the workflow ("Hover: Add CI Workflow"), push, and let it run.');
      return;
    }
    await vscode.commands.executeCommand('hover.refreshDashboard');
    if (res.conclusion === 'failure') {
      const view = 'View run';
      const pick = await vscode.window.showWarningMessage(
        `Hover: CI run #${res.runId} failed — failing specs are marked in the Dashboard.`,
        view,
      );
      if (pick === view) void vscode.env.openExternal(vscode.Uri.parse(res.htmlUrl));
    } else {
      void vscode.window.showInformationMessage(`Hover: CI run #${res.runId} ${res.conclusion ?? 'completed'} — Dashboard updated.`);
    }
  } catch (e) {
    void vscode.window.showErrorMessage(`Hover: CI sync failed — ${e instanceof Error ? e.message : String(e)}`);
  }
}
