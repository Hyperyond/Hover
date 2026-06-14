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
import {
  connectServicePool,
  type AgentEntry,
  type ModeEntry,
  type ServerMessage,
  type ServiceClientPool,
} from './serviceClient.js';
import { SpecLensProvider } from './specLens.js';
import { registerSpecsView } from './specsView.js';
import { registerSessionsView } from './sessionsView.js';
import { registerSeedsView } from './seedsView.js';
import { ChatViewProvider, registerChatView } from './chatView.js';
import { startEngine, stopEngine } from './engine.js';

/** Where the optimizer writes its candidate, relative to the workspace root:
 *  `.hover/cache/optimized/<spec>.draft`. */
const OPTIMIZED_DIR = ['.hover', 'cache', 'optimized'];
const DRAFT_SUFFIX = '.draft';

let pool: ServiceClientPool | undefined;
let currentMode: string | null = null;
let availableModes: ModeEntry[] = [];
let connectedServices = 0;
let modeStatus: vscode.StatusBarItem;
let chatProvider: ChatViewProvider | undefined;

/** The modes the one extension offers, independent of any running service —
 *  mode is the extension's own state (the engine, once hosted here, reads it).
 *  A connected service's reported modes are merged on top. */
const BUILTIN_MODES: ModeEntry[] = [
  { id: 'security', label: 'Security testing', description: 'business / authorization — orange' },
  { id: 'pentest', label: 'Pentest', description: 'offensive vuln hunting — red' },
];

function allModes(): ModeEntry[] {
  const byId = new Map<string, ModeEntry>();
  for (const m of BUILTIN_MODES) byId.set(m.id, m);
  for (const m of availableModes) byId.set(m.id, m);
  return [...byId.values()];
}

function modeLabel(id: string): string {
  return allModes().find((m) => m.id === id)?.label ?? id;
}

let currentAgent: string | null = null;
let availableAgents: AgentEntry[] = [];

/** Agents the extension offers even before a service reports its registry. */
const BUILTIN_AGENTS: AgentEntry[] = [{ id: 'claude' }, { id: 'codex' }];

function allAgents(): AgentEntry[] {
  const byId = new Map<string, AgentEntry>();
  for (const a of BUILTIN_AGENTS) byId.set(a.id, a);
  for (const a of availableAgents) byId.set(a.id, a);
  return [...byId.values()];
}

function agentLabel(id: string | null): string {
  if (!id) return 'Claude';
  return id.charAt(0).toUpperCase() + id.slice(1);
}

// ── Run orchestration ─────────────────────────────────────────────────────
// The chat sends a prompt → the engine runs it → streams events back. We
// accumulate the same message shape the widget sends on save (user / step* /
// ai / done), so "Save as spec" can crystallize the run.
interface SpecMsg {
  kind: string;
  [k: string]: unknown;
}
let transcript: SpecMsg[] = [];
let runSessionId: string | undefined;
let stepCount = 0;

/** Hand a chat prompt to the engine. */
function runPrompt(prompt: string): void {
  if (connectedServices === 0 || !pool) {
    chatProvider?.pushSystem('Engine not connected yet — give it a moment after opening the project, or run "Hover: Start Engine".');
    return;
  }
  transcript.push({ kind: 'user', text: prompt });
  stepCount = 0;
  chatProvider?.setRunning(true);
  if (!pool.run(prompt, runSessionId)) chatProvider?.pushSystem('Could not reach the engine.');
}

/** Translate a streamed engine event into chat updates + transcript. */
function handleServerMessage(msg: ServerMessage): void {
  if (msg.type === 'error') {
    chatProvider?.setRunning(false);
    chatProvider?.pushSystem(String(msg.payload?.message ?? 'error'));
    return;
  }
  if (msg.type === 'spec-saved') {
    chatProvider?.pushSystem(`Saved spec: ${String(msg.payload?.name ?? '')}`);
    return;
  }
  if (msg.type === 'run-active') {
    chatProvider?.setRunning(true);
    return;
  }
  if (msg.type !== 'event') return;
  const ev = msg.payload as { kind?: string; [k: string]: unknown } | undefined;
  switch (ev?.kind) {
    case 'session_start':
      if (typeof ev.sessionId === 'string') runSessionId = ev.sessionId;
      chatProvider?.setRunning(true);
      break;
    case 'tool_use':
      transcript.push({ kind: 'step', tool: ev.tool, input: ev.input });
      stepCount++;
      chatProvider?.pushStep(humanizeTool(String(ev.tool ?? ''), ev.input));
      break;
    case 'text':
      if (typeof ev.text === 'string' && ev.text.trim()) transcript.push({ kind: 'ai', text: ev.text });
      break;
    case 'session_end':
      transcript.push({ kind: 'done', summary: ev.summary, isError: ev.isError });
      chatProvider?.setRunning(false);
      if (ev.cancelled) chatProvider?.pushSystem('Run cancelled.');
      else if (ev.isError) chatProvider?.pushSystem(`Run ended with an error: ${String(ev.summary ?? '')}`);
      else chatProvider?.pushResult('PASS', String(ev.summary ?? 'Done.'), stepCount);
      break;
  }
}

/** Short, human label for a browser/MCP tool call. */
function humanizeTool(tool: string, input: unknown): string {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (tool) {
    case 'browser_navigate': return `Navigate to ${s(i.url)}`;
    case 'browser_click': return `Click ${s(i.element) || s(i.ref) || s(i.selector)}`.trim();
    case 'browser_type': return `Type "${s(i.text)}"${i.element ? ` into ${s(i.element)}` : ''}`;
    case 'browser_fill_form': return 'Fill form';
    case 'browser_select_option': return `Select option ${s(i.element)}`.trim();
    case 'browser_press_key': return `Press ${s(i.key)}`;
    case 'browser_snapshot': return 'Snapshot page';
    case 'browser_take_screenshot': return 'Screenshot';
    case 'browser_wait_for': return 'Wait';
    case 'browser_navigate_back': return 'Go back';
    default: return tool.replace(/^mcp__[a-z0-9_]+__/, '').replace(/^browser_/, '').replace(/_/g, ' ') || tool;
  }
}

async function saveSpec(): Promise<void> {
  let idx = -1;
  for (let i = transcript.length - 1; i >= 0; i--) if (transcript[i].kind === 'user') { idx = i; break; }
  const steps = idx === -1 ? transcript.slice() : transcript.slice(idx);
  if (!steps.some((m) => m.kind === 'step')) {
    void vscode.window.showWarningMessage('Hover: nothing to save — no steps in the last run.');
    return;
  }
  const name = await vscode.window.showInputBox({ title: 'Save as Playwright spec', prompt: 'Spec name', placeHolder: 'login-flow' });
  if (!name) return;
  if (!pool?.saveSpec(name, steps)) void vscode.window.showWarningMessage('Hover: engine not connected.');
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('hover.reviewOptimizationCandidate', (arg?: vscode.TreeItem | vscode.Uri) =>
      reviewOptimizationCandidate(arg),
    ),
    vscode.commands.registerCommand('hover.openSource', (source?: string) => openSource(source)),
    vscode.commands.registerCommand('hover.newProbeSeed', () => newProbeSeed()),
    vscode.commands.registerCommand('hover.runSpec', (item?: vscode.TreeItem | vscode.Uri) => runSpec(item)),
    vscode.commands.registerCommand('hover.switchMode', () => switchMode()),
    vscode.commands.registerCommand('hover.switchAgent', () => switchAgent()),
    vscode.commands.registerCommand('hover.newSession', () => newSession()),
    vscode.commands.registerCommand('hover.saveSpec', () => saveSpec()),
    vscode.commands.registerCommand('hover.cancelRun', () => pool?.cancel()),
    vscode.commands.registerCommand('hover.openRepo', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/Hyperyond/Hover')),
    ),
    vscode.commands.registerCommand('hover.startEngine', () => bootEngine(context, true)),
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
  const chat = registerChatView();
  chatProvider = chat.provider;
  chatProvider.runHandler = (prompt) => runPrompt(prompt);
  context.subscriptions.push(chat.disposable, ...registerSpecsView(), ...registerSessionsView(), ...registerSeedsView());

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
      chatProvider?.updateStatus(connected > 0 ? 'ready' : 'no engine');
    },
    onModes: (current, available) => {
      currentMode = current;
      availableModes = available;
      renderModeStatus();
      chatProvider?.updateMode(currentMode, currentMode ? modeLabel(currentMode) : null);
    },
    onAgents: (current, available) => {
      currentAgent = current;
      availableAgents = available;
      chatProvider?.updateAgent(agentLabel(currentAgent));
    },
    onServerMessage: (msg) => handleServerMessage(msg),
  });
  context.subscriptions.push({ dispose: () => pool?.dispose() });

  // Self-contained (Path A): boot the engine in-extension so the WS pool
  // connects with no bundler plugin / dev server. Fire-and-forget; the pool
  // connects when it's up. A missing staged engine (e.g. dev build before
  // `stage:engine`) just leaves the extension in connect-when-available mode.
  void bootEngine(context, false);

  // One-time nudge: VSCode can't default a view to the Secondary Side Bar, so
  // guide the user to dock Chat on the right for a code-center / chat-right
  // layout (the placement persists once they move it).
  if (!context.globalState.get('hover.chatHintShown')) {
    void context.globalState.update('hover.chatHintShown', true);
    void vscode.window.showInformationMessage(
      'Hover Chat opened as its own panel. Drag it to the right (Secondary Side Bar) for a chat-beside-code layout.',
      'Open Chat',
    ).then((pick) => {
      if (pick === 'Open Chat') void vscode.commands.executeCommand('hover.chat.focus');
    });
  }
}

export function deactivate(): void {
  pool?.dispose();
  stopEngine();
}

/** Start the hosted engine for the first workspace folder. `announce` shows a
 *  toast on success/failure (for the explicit Start Engine command). */
async function bootEngine(ctx: vscode.ExtensionContext, announce: boolean): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    if (announce) void vscode.window.showWarningMessage('Hover: open a project folder to start the engine.');
    return;
  }
  try {
    const enginePort = await startEngine(ctx, root);
    if (announce) void vscode.window.showInformationMessage(`Hover engine running on 127.0.0.1:${enginePort}.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Quiet on auto-start (the staged engine may be absent in dev); loud on demand.
    if (announce) void vscode.window.showErrorMessage(`Hover engine failed to start: ${msg}`);
    else console.error('[hover] engine auto-start failed:', msg);
  }
}

function renderModeStatus(): void {
  if (!modeStatus) return;
  const label = currentMode ? modeLabel(currentMode) : null;
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
  // Mode is the extension's own state, so this always works — no running
  // service required. When a service IS connected, we also push the change to
  // it; otherwise it applies locally and takes effect on the next run.
  type Pick = vscode.QuickPickItem & { modeId: string | null };
  const items: Pick[] = [
    { label: '$(circle-outline) Normal', description: 'testing — no security mode', modeId: null },
    ...allModes().map((m) => ({
      label: `${m.id === 'pentest' ? '$(flame)' : '$(shield)'} ${m.label}`,
      description: m.description ?? m.id,
      modeId: m.id,
    })),
  ];
  for (const it of items) if (it.modeId === currentMode) it.label = `$(check) ${it.label}`;
  const picked = await vscode.window.showQuickPick(items, { title: 'Hover: switch mode', placeHolder: 'Select a mode' });
  if (!picked) return;
  currentMode = picked.modeId;
  renderModeStatus();
  chatProvider?.updateMode(currentMode, currentMode ? modeLabel(currentMode) : null);
  if (connectedServices > 0) pool?.setMode(picked.modeId);
  else
    vscode.window.setStatusBarMessage(
      'Hover: mode set locally — it applies when the engine runs (no live service connected).',
      4000,
    );
}

async function switchAgent(): Promise<void> {
  type Pick = vscode.QuickPickItem & { agentId: string };
  const items: Pick[] = allAgents().map((a) => ({
    label: `${a.id === currentAgent ? '$(check) ' : ''}${agentLabel(a.id)}`,
    description: a.installed === false ? 'not installed' : a.id,
    agentId: a.id,
  }));
  const picked = await vscode.window.showQuickPick(items, { title: 'Hover: switch agent', placeHolder: 'Select a coding agent' });
  if (!picked) return;
  currentAgent = picked.agentId;
  chatProvider?.updateAgent(agentLabel(currentAgent));
  if (connectedServices > 0) pool?.switchAgent(picked.agentId);
  else vscode.window.setStatusBarMessage('Hover: agent set locally — applies when the engine runs.', 4000);
}

async function newSession(): Promise<void> {
  transcript = [];
  runSessionId = undefined;
  stepCount = 0;
  await chatProvider?.reveal();
  chatProvider?.newSession();
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
