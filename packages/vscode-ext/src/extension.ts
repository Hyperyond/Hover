/**
 * `hover-dev` — Hover's VSCode extension entry.
 *
 * Per the security-direction design (§3.2) this is Hover's **primary surface**:
 * a native GUI face (no webview) over the agent-agnostic engine in
 * `@hover-dev/cli` / `@hover-dev/core`. ONE extension for both AI test authoring
 * and application-security testing — the split is a mode switch (normal /
 * security-orange / pentest-red), reusing the engine's `set-mode` protocol.
 *
 * Surfaces:
 *   • Activity Bar "Hover" → Specs (Tests/Security), Sessions, Seeds tree views
 *   • Status bar → current mode + service connection; click to switch mode
 *   • F1 review optimization candidate · F2 element→source · F3 spec CodeLens ·
 *     F4 probe-seed authoring · run a spec in the terminal
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { connectServicePool, type ModeEntry, type ServiceClientPool } from './serviceClient.js';
import { SpecLensProvider } from './specLens.js';
import { registerSpecsView } from './specsView.js';
import { registerSessionsView } from './sessionsView.js';
import { registerSeedsView } from './seedsView.js';
import { registerChatView } from './chatView.js';

/** Where the optimizer writes its candidate, relative to the workspace root:
 *  `.hover/cache/optimized/<spec>.draft`. */
const OPTIMIZED_DIR = ['.hover', 'cache', 'optimized'];
const DRAFT_SUFFIX = '.draft';

let pool: ServiceClientPool | undefined;
let currentMode: string | null = null;
let availableModes: ModeEntry[] = [];
let connectedServices = 0;
let modeStatus: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('hover.reviewOptimizationCandidate', (arg?: vscode.TreeItem | vscode.Uri) =>
      reviewOptimizationCandidate(arg),
    ),
    vscode.commands.registerCommand('hover.openSource', (source?: string) => openSource(source)),
    vscode.commands.registerCommand('hover.newProbeSeed', () => newProbeSeed()),
    vscode.commands.registerCommand('hover.runSpec', (item?: vscode.TreeItem | vscode.Uri) => runSpec(item)),
    vscode.commands.registerCommand('hover.switchMode', () => switchMode()),
    vscode.commands.registerCommand('hover.specs.focus', () =>
      vscode.commands.executeCommand('workbench.view.extension.hover'),
    ),
    vscode.languages.registerCodeLensProvider(
      { language: 'typescript', scheme: 'file', pattern: '**/*.spec.ts' },
      new SpecLensProvider(),
    ),
  );

  // Sidebar under the Hover Activity Bar container: chat (webview) + three
  // native tree views.
  context.subscriptions.push(
    registerChatView(),
    ...registerSpecsView(),
    ...registerSessionsView(),
    ...registerSeedsView(),
  );

  // Status bar: current mode + service connection, click to switch mode.
  modeStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  modeStatus.command = 'hover.switchMode';
  renderModeStatus();
  modeStatus.show();
  context.subscriptions.push(modeStatus);

  // Connect to the running Hover service(s): F2 relays, status, mode state.
  pool = connectServicePool({
    onRevealSource: (source) => void openSource(source),
    onStatus: (connected) => {
      connectedServices = connected;
      renderModeStatus();
    },
    onModes: (current, available) => {
      currentMode = current;
      availableModes = available;
      renderModeStatus();
    },
  });
  context.subscriptions.push({ dispose: () => pool?.dispose() });
}

export function deactivate(): void {
  pool?.dispose();
}

function renderModeStatus(): void {
  if (!modeStatus) return;
  const label = currentMode ? availableModes.find((m) => m.id === currentMode)?.label ?? currentMode : null;
  const disconnected = connectedServices === 0;
  modeStatus.text = `$(sparkle) Hover${label ? `: ${label}` : ''}${disconnected ? ' $(circle-slash)' : ''}`;
  modeStatus.backgroundColor =
    currentMode === 'pentest'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : currentMode === 'security'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
  modeStatus.tooltip = disconnected
    ? 'Hover — no dev service detected. Start a Hover-enabled dev server, then click to switch mode.'
    : `Hover — ${connectedServices} service${connectedServices > 1 ? 's' : ''} connected${
        label ? `, mode: ${label}` : ', normal mode'
      }. Click to switch mode.`;
}

async function switchMode(): Promise<void> {
  if (connectedServices === 0) {
    void vscode.window.showWarningMessage('Hover: no dev service connected. Start a Hover-enabled dev server first.');
    return;
  }
  type Pick = vscode.QuickPickItem & { modeId: string | null };
  const items: Pick[] = [
    { label: '$(circle-outline) Normal', description: 'testing (no security mode)', modeId: null },
    ...availableModes.map((m) => ({
      label: `${m.id === 'pentest' ? '$(flame)' : '$(shield)'} ${m.label}`,
      description: m.description ?? m.id,
      modeId: m.id,
    })),
  ];
  for (const it of items) if (it.modeId === currentMode) it.label = `$(check) ${it.label}`;
  const picked = await vscode.window.showQuickPick(items, { title: 'Hover: switch mode', placeHolder: 'Select a mode' });
  if (picked) pool?.setMode(picked.modeId);
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
  const folder = vscode.workspace.getWorkspaceFolder(specUri);
  if (!folder) {
    void vscode.window.showWarningMessage('Hover: the spec is not inside an open workspace folder.');
    return;
  }
  const fileName = path.basename(specUri.fsPath);
  const candidate = vscode.Uri.joinPath(folder.uri, ...OPTIMIZED_DIR, fileName + DRAFT_SUFFIX);
  try {
    await vscode.workspace.fs.stat(candidate);
  } catch {
    void vscode.window.showInformationMessage(
      `Hover: no optimization candidate for ${fileName}. Run \`hover optimize\` first.`,
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

/** Run one spec in a terminal via Playwright. We delegate to the user's
 *  Playwright runner rather than reimplementing a test explorer (the official
 *  Playwright extension owns that, design non-goal N1) — this is just a
 *  one-click `playwright test <file>` convenience. */
async function runSpec(arg?: vscode.TreeItem | vscode.Uri): Promise<void> {
  const uri =
    arg instanceof vscode.Uri ? arg : (arg?.resourceUri ?? vscode.window.activeTextEditor?.document.uri);
  if (!uri || uri.scheme !== 'file') {
    void vscode.window.showWarningMessage('Hover: open or select a spec to run.');
    return;
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const cwd = folder?.uri.fsPath;
  const rel = folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath;
  const terminal = vscode.window.createTerminal({ name: 'Hover · Playwright', cwd });
  terminal.show();
  terminal.sendText(`npx playwright test ${JSON.stringify(rel)}`);
}

/**
 * F2 (editor-side) — reveal the source location behind a page element.
 */
async function openSource(source?: string): Promise<void> {
  let value = source;
  if (!value) {
    value = await vscode.window.showInputBox({
      title: 'Hover: open source',
      prompt: 'Paste a data-hover-source value',
      placeHolder: 'src/components/Login.tsx:42:5',
    });
  }
  const parsed = value ? parseHoverSource(value) : null;
  if (!parsed) {
    if (value) void vscode.window.showWarningMessage(`Hover: "${value}" is not a valid path:line:col source.`);
    return;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage('Hover: open a workspace folder to resolve the source path.');
    return;
  }
  const target = await firstExisting(folders.map((f) => vscode.Uri.joinPath(f.uri, parsed.path)));
  if (!target) {
    void vscode.window.showWarningMessage(`Hover: could not find ${parsed.path} in the open workspace.`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  const editor = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(Math.max(0, parsed.line - 1), Math.max(0, parsed.col - 1));
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/** Parse a `data-hover-source` value `<rel-path>:<line>:<col>` (1-indexed). */
export function parseHoverSource(value: string): { path: string; line: number; col: number } | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(value.trim());
  if (!m) return null;
  return { path: m[1], line: Number(m[2]), col: Number(m[3]) };
}

/**
 * F4 — scaffold a new security probe seed under `.hover/rules/security/`.
 */
async function newProbeSeed(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showWarningMessage('Hover: open a workspace folder to create a seed.');
    return;
  }
  const name = await vscode.window.showInputBox({
    title: 'Hover: new probe seed',
    prompt: 'Seed name (kebab-case)',
    placeHolder: 'idor-numeric-id',
    validateInput: (v) =>
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.trim()) ? null : 'Use kebab-case: lower-case letters, digits, hyphens.',
  });
  if (!name) return;
  const slug = name.trim();
  const target = vscode.Uri.joinPath(folders[0].uri, '.hover', 'rules', 'security', `${slug}.json`);
  if (await firstExisting([target])) {
    void vscode.window.showWarningMessage(`Hover: a seed named "${slug}" already exists.`);
    await vscode.window.showTextDocument(target);
    return;
  }
  const template = {
    name: slug,
    class: 'idor',
    category: 'authz',
    note: '',
    match: { method: ['GET'], urlParam: '/REPLACE/\\d+', needsAuth: true },
    probe: {
      strategy: "swap the id for another user's id and replay",
      signal: "200 OK returning the other user's record",
      secondIdentity: true,
    },
  };
  await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(template, null, 2) + '\n', 'utf-8'));
  await vscode.window.showTextDocument(target);
}

/** Return the first URI that exists on disk, or undefined if none do. */
async function firstExisting(uris: vscode.Uri[]): Promise<vscode.Uri | undefined> {
  for (const uri of uris) {
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}
