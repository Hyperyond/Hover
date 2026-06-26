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
 *   • Activity Bar "Hover" → Specs (folder-grouped), Sessions, Environments
 *   • Status bar → current mode + service connection; click to switch mode
 *   • F1 review optimization candidate · F2 element→source · F3 spec CodeLens ·
 *     run a spec in the terminal
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import {
  connectServicePool,
  type AgentEntry,
  type ModeEntry,
  type ServerMessage,
  type ServiceClientPool,
} from './serviceClient.js';
import { SpecLensProvider } from './specLens.js';
import { registerDashboardView } from './dashboardView.js';
import { registerTrafficView, type TrafficViewProvider, type Flow } from './trafficView.js';
import { registerConversationsView, type ConversationsViewProvider } from './conversationsView.js';
import { ChatViewProvider, registerChatView } from './chatView.js';
import { registerSettingsView, type SettingsViewProvider, type SettingsByokState } from './settingsView.js';
import { EnvironmentStore, LOCAL_ENV_ID, accountEnvVar, type ResolvedAccount, type ResetRecipe } from './environments.js';
import { registerEnvironmentsView } from './environmentsView.js';
import { buildWorkflowYaml } from './ciWorkflow.js';
import { acquireEngine, releaseSession, portForSession, sessionForPort, stopEngine } from './engine.js';
import { candidateUri, uriExists } from './optimized.js';

let pool: ServiceClientPool | undefined;
let currentMode: string | null = null;
// Whether QA's API / Pentest capabilities can run (their runtimes up) — from the
// engine's `modes` broadcast. Gate the QA toggles so "on" always works.
let apiCapabilityAvailable = false;
let pentestCapabilityAvailable = false;
let availableModes: ModeEntry[] = [];
let connectedServices = 0;
let modeStatus: vscode.StatusBarItem;
let chatProvider: ChatViewProvider | undefined;
let settingsProvider: SettingsViewProvider | undefined;
let conversationsProvider: ConversationsViewProvider | undefined;
let trafficProvider: TrafficViewProvider | undefined;

let extContext: vscode.ExtensionContext | undefined;

/** Push the active environment's accounts (no passwords) to the chat for the
 *  `@` autocomplete. */
async function pushAccounts(): Promise<void> {
  const active = await envStore?.getActive();
  const list = (active?.accounts ?? []).map((a) => ({ label: a.label, role: a.role, username: a.username }));
  chatProvider?.updateAccounts(list);
}

/** Push speech + silent flags + chosen narration voices to the chat. */
function pushChatConfig(): void {
  const cfg = vscode.workspace.getConfiguration('hover');
  chatProvider?.updateConfig(
    cfg.get<boolean>('speech', false),
    cfg.get<string>('browser', 'silent') !== 'visible',
    extContext?.globalState.get<string>('hover.speechVoiceZh', '') ?? '',
    extContext?.globalState.get<string>('hover.speechVoiceEn', '') ?? '',
  );
}

/** When the engine (re)connects, hand it the persisted agent / model config. */
async function pushEngineConfig(): Promise<void> {
  if (!pool) return;
  const cfg = vscode.workspace.getConfiguration('hover');
  const agent = cfg.get<string>('agent', '');
  if (agent) pool.switchAgent(agent);
  const model = cfg.get<string>('model', 'sonnet');
  if (model) pool.setModel(model);
  const effort = cfg.get<string>('effort', '');
  pool.setEffort(effort);
  pool.setLocalEndpoint(cfg.get<string>('localBaseUrl', ''));
  await pushByok();
}

/** The modes the one extension offers, independent of any running service —
 *  mode is the extension's own state (the engine, once hosted here, reads it).
 *  A connected service's reported modes are merged on top. */
const BUILTIN_MODES: ModeEntry[] = [
  { id: 'qa', label: 'QA Testing', description: 'explore the whole app → findings report + promotable specs' },
  { id: 'api-test', label: 'API testing', description: 'drive & verify your API — auth, status, access control' },
  { id: 'pentest', label: 'Pentest', description: 'offensive vuln hunting — red' },
];

function allModes(): ModeEntry[] {
  const byId = new Map<string, ModeEntry>();
  for (const m of BUILTIN_MODES) byId.set(m.id, m);
  for (const m of availableModes) byId.set(m.id, m);
  return [...byId.values()];
}

function modeLabel(id: string): string {
  // 'api-test' is surfaced to users as "API testing" (its real-world use); the
  // internal id + plugin stay 'api-test'. Force it so an engine-reported label
  // can't override the display name.
  if (id === 'api-test') return 'API testing';
  if (id === 'qa') return 'QA Testing';
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

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  // qwen-code is the OpenAI-compatible host for a user's self-hosted model.
  qwen: 'Local LLM',
};
function agentLabel(id: string | null): string {
  if (!id) return 'Claude';
  return AGENT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** `config.update` that never throws. VS Code rejects writes to an unregistered
 *  key (or a read-only target); that rejection used to abort whatever ran after
 *  it (e.g. the model-list refresh), so a stale build or missing key would
 *  silently freeze the UI. Persisting is best-effort — in-memory state + engine
 *  sync proceed regardless. */
async function safeUpdate(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
): Promise<void> {
  try {
    await vscode.workspace.getConfiguration('hover').update(key, value, target);
  } catch (e) {
    console.error(`[hover] config write failed for hover.${key}:`, e instanceof Error ? e.message : e);
  }
}

/** Model picker lists per agent — the `--model` value the CLI accepts + a
 *  display label. Current as of 2026-06; trim deprecated tiers. The chat model
 *  picker reads the list for the active agent (chosen in Settings). */
// `efforts` = the reasoning-effort levels THIS model accepts (empty = the model
// has no effort control → the picker hides it). `effortDefault` = the level used
// when none is chosen. Values verified against the current effort matrices:
// Claude (low/medium/high/xhigh/max, gated by model), Codex (minimal/low/medium/
// high/xhigh). `disabled` greys the row out (not yet selectable).
interface ModelEntry {
  value: string;
  label: string;
  desc?: string;
  disabled?: boolean;
  efforts?: string[];
  effortDefault?: string;
}
const CLAUDE_EFFORTS_TOP = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL_LISTS: Record<string, ModelEntry[]> = {
  claude: [
    { value: 'sonnet', label: 'Sonnet 4.6', desc: 'Balanced — the default', efforts: ['low', 'medium', 'high', 'max'], effortDefault: 'high' },
    { value: 'opus', label: 'Opus 4.8', desc: 'Most capable (~5× cost)', efforts: CLAUDE_EFFORTS_TOP, effortDefault: 'high' },
    { value: 'haiku', label: 'Haiku 4.5', desc: 'Fast & cheap', efforts: [] },
    { value: 'claude-fable-5', label: 'Fable 5', desc: 'Always-on deep reasoning', disabled: true, efforts: CLAUDE_EFFORTS_TOP, effortDefault: 'high' },
  ],
  codex: [
    { value: 'gpt-5.5', label: 'GPT-5.5', desc: 'Strongest — the default', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], effortDefault: 'medium' },
    { value: 'gpt-5.4', label: 'GPT-5.4', desc: 'Flagship reasoning', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], effortDefault: 'medium' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4-mini', desc: 'Fast & cheap', efforts: ['minimal', 'low', 'medium', 'high'], effortDefault: 'medium' },
  ],
  gemini: [
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Most capable', efforts: [] },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: 'Fast & cheap', efforts: [] },
    { value: 'auto', label: 'Auto', desc: 'Let Gemini route the request', efforts: [] },
  ],
  // Qwen Code is a model-agnostic OpenAI-compatible CLI; it runs on whatever
  // model its endpoint serves (`value: ''` = pass no --model override).
  qwen: [{ value: '', label: 'Default', desc: "Qwen Code's configured model", efforts: [] }],
};
function activeAgentId(): string {
  return currentAgent ?? (vscode.workspace.getConfiguration('hover').get<string>('agent') || 'claude');
}
function modelsForAgent(agent: string): ModelEntry[] {
  return MODEL_LISTS[agent] ?? MODEL_LISTS.claude;
}
/** Push the current agent's model list + active model to the chat picker.
 *  If the stored model isn't valid for the agent (e.g. switched claude→codex),
 *  fall back to that agent's default and persist it. */
async function pushModels(): Promise<void> {
  const agent = activeAgentId();
  const cfg = vscode.workspace.getConfiguration('hover');
  // Local LLM (qwen host): the model is a free-text id configured in Settings
  // (its own hover.localModel, kept separate from the curated hover.model), so
  // there's no list to reconcile — just hand the engine that model + show it.
  if (agent === 'qwen') {
    const lm = cfg.get<string>('localModel', '');
    pool?.setModel(lm);
    // Locked: the local model is configured in Settings, not picked here — the
    // chat model button shows it but doesn't open a picker.
    chatProvider?.updateModels([{ value: lm, label: lm || 'Local model — set in Settings' }], lm, { options: [], current: '' }, true);
    return;
  }
  const list = modelsForAgent(agent);
  const selectable = list.filter((m) => !m.disabled);
  let model = cfg.get<string>('model', '');
  if (!selectable.some((m) => m.value === model)) {
    model = (selectable[0] ?? list[0]).value;
    await safeUpdate('model', model);
    pool?.setModel(model);
  }
  // Reconcile the effort level to what the selected model supports (a model
  // with no effort control clears it; an incompatible level snaps to the
  // model's default), then hand the engine the effective level.
  const efforts = list.find((m) => m.value === model)?.efforts ?? [];
  const effDefault = list.find((m) => m.value === model)?.effortDefault ?? efforts[efforts.length - 1] ?? '';
  let effort = cfg.get<string>('effort', '');
  const want = efforts.length ? (efforts.includes(effort) ? effort : effDefault) : '';
  if (want !== effort) { effort = want; await safeUpdate('effort', effort); }
  pool?.setEffort(effort);
  chatProvider?.updateModels(list, model, { options: efforts, current: effort });
}

// ── BYOK (bring-your-own-key) ──────────────────────────────────────────────
// The API key lives in SecretStorage, keyed per protocol so switching protocols
// keeps each provider's key. The rest of the config is plain `hover.byok.*`.
function byokSecretKey(protocol: string): string {
  return `hover.byok.key.${protocol}`;
}
/** Current BYOK config for the Settings panel (key presence only). */
async function readByok(): Promise<SettingsByokState> {
  const cfg = vscode.workspace.getConfiguration('hover');
  const protocol = cfg.get<string>('byok.protocol', 'anthropic');
  const key = await extContext?.secrets.get(byokSecretKey(protocol));
  return {
    protocol,
    gateway: cfg.get<string>('byok.gateway', 'none'),
    baseUrl: cfg.get<string>('byok.baseUrl', ''),
    model: cfg.get<string>('byok.model', ''),
    maxTokens: cfg.get<number>('byok.maxTokens', 0),
    hasKey: !!key,
  };
}
/** Push the effective model source to the engine: a full BYOK config when the
 *  BYOK tab is active (and a key is set), or null to fall back to the local-CLI
 *  agent's own auth. Sent via `set-byok`. */
async function pushByok(): Promise<void> {
  if (!pool) return;
  const cfg = vscode.workspace.getConfiguration('hover');
  const source = cfg.get<string>('modelSource', 'cli');
  if (source !== 'byok') {
    pool.setByok(null);
    return;
  }
  const protocol = cfg.get<string>('byok.protocol', 'anthropic');
  const apiKey = (await extContext?.secrets.get(byokSecretKey(protocol))) || '';
  pool.setByok({
    protocol,
    baseUrl: cfg.get<string>('byok.baseUrl', '').trim(),
    model: cfg.get<string>('byok.model', '').trim(),
    maxTokens: cfg.get<number>('byok.maxTokens', 0),
    apiKey,
  });
}

/** Apply a reasoning-effort pick from the chat model menu. */
async function setEffort(value: string): Promise<void> {
  await safeUpdate('effort', value);
  if (connectedServices > 0) pool?.setEffort(value);
  await pushModels();
}

// ── Run orchestration ─────────────────────────────────────────────────────
// The chat sends a prompt → the engine runs it → streams events back. We
// accumulate the same message shape the widget sends on save (user / step* /
// ai / done), so "Save as spec" can crystallize the run.
interface SpecMsg {
  kind: string;
  [k: string]: unknown;
}
/** Tools that aren't real, replayable test actions: read-only perception
 *  (snapshot / screenshot / wait), source exploration (read/list), and meta
 *  (ask_user / mark_flow). A run made up of ONLY these has nothing to
 *  crystallize — it shows as a plain reply, not a Done card with "Save spec?". */
const NON_SAVEABLE_TOOLS = new Set([
  'browser_snapshot', 'browser_take_screenshot', 'browser_wait_for', 'mark_flow',
  'read_source', 'list_source', 'ask_user',
]);
/** A "saveable" tool is one that crystallizes into a spec step (a real browser
 *  action), as opposed to exploration noise (snapshot / wait / source reads /
 *  ask_user). The per-run `stepCount` increments only on these. */
function isSaveableTool(tool: unknown): boolean {
  const t = String(tool ?? '').replace(/^mcp__.*?__/, '');
  return t !== '' && !NON_SAVEABLE_TOOLS.has(t);
}
/** True when the agent's final text contains a `hover-ask` block — i.e. the run
 *  ended by asking the user to choose, so the task is NOT concluded (the user's
 *  answer starts a follow-up run). Presence check; mirrors the webview's
 *  HOVER_ASK_RE (followup.ts). */
function endsWithHoverAsk(text: string): boolean {
  return /```hover-ask/i.test(text);
}
/** A live chat conversation: its transcript + the agent session id used to
 *  --resume follow-up turns. Multiple coexist; one is active. Persisted to
 *  workspaceState so they survive reload. Each session drives its OWN engine
 *  host + browser (multi-host model) — `enginePort` is that host once spawned;
 *  it is runtime-only (not persisted). Runs are still sequential across sessions
 *  (switching is blocked mid-run); true simultaneous parallel is the next pass. */
interface ChatSession {
  id: string;
  name: string;
  transcript: SpecMsg[];
  agentSessionId?: string;
  createdAt: number;
  /** Epoch ms of this conversation's most recent run start (for the sidebar's
   *  "last run N ago"). Persisted. */
  lastRunAt?: number;
  // Runtime-only (not persisted): live run state. True parallel — several
  // sessions can run at once, each on its own host; events route to the owning
  // session by source port (looked up live via portForSession), not the active
  // one.
  running?: boolean;
  /** Per-run count of saveable (crystallizable) actions. Reset to 0 at each run
   *  start; incremented only on saveable tools. Read at session_end to gate the
   *  Done-vs-clarification branch + Save prompt. Runtime-only. */
  stepCount?: number;
  /** Set when a run ends by asking the user a `hover-ask` question — the task
   *  isn't concluded, so the NEXT run inherits this run's `stepCount` instead of
   *  resetting it. Without this, a clarify splits one task into two runs and the
   *  closing 0-action wrap-up turn loses its Done card (+ Save). Consumed (and
   *  cleared) at the next run start. Runtime-only. */
  carryStepCount?: boolean;
  runCost?: number;
  runTokens?: number;
  /** Per-run source-read grant ("Allow once" / "Deny"); reset each run. Per
   *  session so one session's grant never auto-allows another's reads. */
  sourceGrant?: 'allow' | 'deny';
  /** @-mention accounts for THIS session's run — kept so "Save as spec" can
   *  redact their creds into process.env refs (per session: parallel runs). */
  lastAccounts?: ResolvedAccount[];
}
let sessions: ChatSession[] = [];
let activeSessionId = '';

function sessionById(id: string | undefined): ChatSession | undefined {
  return id ? sessions.find((s) => s.id === id) : undefined;
}
/** Sessions with a run in flight — never evicted from the host pool. */
function busySessions(): Set<string> {
  return new Set(sessions.filter((s) => s.running).map((s) => s.id));
}
/** Toggle a session's run state: drive the chat spinner only when it's the
 *  visible session, and refresh the switcher's running badges either way. */
function setSessionRunning(sess: ChatSession, on: boolean): void {
  sess.running = on;
  if (sess.id === activeSessionId) chatProvider?.setRunning(on);
  pushSessionList();
}
/** The engine host serving the active session (multi-host model). Run-scoped
 *  messages (run / launch-chrome / cancel / approvals) target this port. */
function activeEnginePort(): number | undefined {
  return portForSession(activeSessionId);
}
/** Pending in-chat prompt cards (ask_user + source-approval): card id → the
 *  resolver to run with the user's answer. Lets several prompt kinds share the
 *  one card UI + the one askUserAnswer round-trip. */
const pendingCards = new Map<string, (value: string | null) => void>();
/** Auth-as-fixture (debt 3): save params stashed by spec name, so an APPROVED
 *  config edit can re-save the same spec with the fixture engaged. */
const fixtureResaves = new Map<string, { steps: unknown[]; redactions: { value: string; envVar: string }[]; resetRecipe?: { tier: number; storageKeys?: string[]; hook?: string } }>();
/** Minimal additive diff for the config-edit preview — lines in `after` not in
 *  `before`, `+`-prefixed (the ts-morph edit only inserts a `projects` block). */
function additiveConfigDiff(before: string, after: string): string {
  const seen = new Set(before.split('\n').map((l) => l.trim()));
  return after.split('\n').filter((l) => l.trim() && !seen.has(l.trim())).map((l) => `+ ${l}`).join('\n');
}
/** The prompt card awaiting an answer in each session, so a prompt from a
 *  BACKGROUND session doesn't pop in the conversation you're watching — it's
 *  rendered only when its session is active, and re-rendered on switch-back. */
type AskReq = { askId: string; question: string; options: { label: string; description?: string }[]; other?: boolean };
const pendingAsks = new Map<string, AskReq>();
/** Most recent reachable dev URL (configured or auto-detected). */
let detectedUrl: string | null = null;
/** Test-environment + account store (Local + configured domains). */
let envStore: EnvironmentStore | undefined;

/** The run target = the active environment's URL. For `local` we keep the
 *  existing zero-config behaviour (configured appUrl, else auto-detected). */
async function resolveTargetUrl(): Promise<string | null> {
  const active = await envStore?.getActive();
  if (!active || active.id === LOCAL_ENV_ID) {
    return vscode.workspace.getConfiguration('hover').get<string>('appUrl') || detectedUrl;
  }
  return active.url;
}
/** In-flight ensureBrowser() handshakes, keyed by the host's engine port, so
 *  several sessions can launch their browsers in parallel without clobbering
 *  each other's wait. Key 0 = "no specific host" (single-host fallback). */
const pendingBrowserByPort = new Map<number, (ok: boolean) => void>();
/** Spec being optimized, so we can auto-open the diff when the candidate lands. */
let pendingOptimizeUri: vscode.Uri | undefined;
/** Watchdog so a hung optimize doesn't leave the spinner spinning forever. */
let optimizeTimer: ReturnType<typeof setTimeout> | undefined;

/** Stop the optimize spinner + watchdog (on result, failure, or timeout). */
function endOptimize(): void {
  if (optimizeTimer) { clearTimeout(optimizeTimer); optimizeTimer = undefined; }
  chatProvider?.clearBusy();
}

/** Ensure a debug browser is up before a run. Idempotent on the engine side
 *  (launchDebugChrome no-ops if Chrome is already on the CDP port), so this
 *  both first-launches and relaunches a browser that went away. */
function ensureBrowser(url: string, enginePort?: number): Promise<boolean> {
  if (!pool) return Promise.resolve(false);
  const port = enginePort ?? activeEnginePort();
  const key = port ?? 0;
  return new Promise((resolve) => {
    pendingBrowserByPort.get(key)?.(false); // supersede any prior wait for this host
    let timer: ReturnType<typeof setTimeout>;
    const done = (ok: boolean): void => {
      if (pendingBrowserByPort.get(key) !== done) return;
      clearTimeout(timer);
      pendingBrowserByPort.delete(key);
      resolve(ok);
    };
    pendingBrowserByPort.set(key, done);
    timer = setTimeout(() => done(false), 25_000);
    // Target the session's own host so it launches THAT session's browser
    // (its own profile / login). Falls back to the first host when unset.
    pool?.launchChrome(url, isSilent(), false, port);
  });
}

/** Hand a chat prompt to the engine, ensuring the browser is up first. */
async function runPrompt(prompt: string, displayText?: string): Promise<void> {
  if (!pool) {
    chatProvider?.pushSystem('Engine not connected yet — give it a moment after opening the project, or run "Hover: Start Engine".');
    return;
  }
  // Capture the session the prompt was typed into. The user may switch away
  // while this run is in flight (parallel model); everything below operates on
  // `sess`, never the moving active session.
  const sess = activeChat();
  // `displayText` lets a machine-built prompt (e.g. a self-heal run) show a
  // short, friendly bubble while the agent still receives the full instruction.
  const bubble = displayText ?? prompt;
  nameSessionFromPrompt(bubble);
  sess.transcript.push({ kind: 'user', text: bubble });
  // Normally reset the saveable-action counter per run. But if the previous run
  // ended by asking the user a hover-ask question, the task continues into this
  // run — carry the count forward so a 0-action wrap-up still renders a Done card.
  if (sess.carryStepCount) sess.carryStepCount = false;
  else sess.stepCount = 0;
  sess.runCost = 0;
  sess.runTokens = 0;
  sess.lastRunAt = Date.now(); // for the sidebar's "last run N ago"
  sess.sourceGrant = undefined; // fresh per run
  setSessionRunning(sess, true);

  // Multi-host: ensure THIS session has its own engine host (its own browser),
  // spawning it if needed. Busy sessions (a run in flight) are never evicted.
  const enginePort = await ensureSessionEngine(sess.id);
  if (enginePort == null) {
    setSessionRunning(sess, false);
    pushToSession(sess, 'system', `Couldn't start an engine for this session (max 4 browsers in use — finish a run first).`);
    return;
  }

  // Resolve @account mentions → creds for the agent to log in with; remembered
  // on the session so "Save as spec" redacts those creds into process.env refs.
  sess.lastAccounts = (await envStore?.resolveMentions(prompt)) ?? [];
  const accounts = sess.lastAccounts.map((a) => ({ label: a.label, username: a.username, password: a.password, role: a.role }));
  const missing = sess.lastAccounts.filter((a) => !a.password).map((a) => a.label);
  if (missing.length) {
    pushToSession(sess, 'system', `Heads up: @${missing.join(', @')} has no stored password — set one in Environments (🔑) so the agent can log in.`);
  }

  const url = await resolveTargetUrl();
  if (!url) {
    setSessionRunning(sess, false);
    pushToSession(sess, 'system', 'No target URL — start your dev server, then click "▶ Start App" (or set a local URL).');
    return;
  }
  // Real reachability gate. A matching Chrome tab is NOT proof the server is up:
  // a connection-refused page keeps the same origin in the address bar, so the
  // CDP "same-window" check passes even when nothing is serving. Probe HTTP first
  // so the agent never runs against a dead page.
  if (!(await probeUrl(url, 4000))) {
    setSessionRunning(sess, false);
    pushToSession(sess, 'system', `Couldn't reach ${url} — the dev server isn't responding. Start it, then click "▶ Start App".`);
    return;
  }
  const ready = await ensureBrowser(url, enginePort);
  if (!ready) {
    setSessionRunning(sess, false);
    pushToSession(sess, 'system', `Couldn't reach a browser at ${url}. Click "▶ Start App".`);
    return;
  }
  const activeEnv = await envStore?.getActive();
  // Memory: "isolated" runs the agent in a throwaway cwd so it loads none of the
  // user's CLAUDE.md / Claude Code auto-memory; "shared" (default) keeps the
  // project context. Stored in extension globalState (see the Settings handler).
  const isolateContext = (extContext?.globalState.get<string>('hover.agentContext', 'shared') ?? 'shared') === 'isolated';
  // QA intensity (Quick/Standard/Deep) bounds an exploratory run's spend; only
  // applied engine-side when the mode is QA, harmless to send otherwise.
  const qaIntensity = extContext?.globalState.get<string>('hover.qaIntensity', 'standard') ?? 'standard';
  // QA API capability toggle (default on). Only effective in QA mode when the
  // api-test runtime is available; the engine gates the rest.
  const qaApi = extContext?.globalState.get<boolean>('hover.qaApi', true) ?? true;
  // Pentest is offensive — default OFF, mutually exclusive with API (engine enforces).
  const qaPentest = extContext?.globalState.get<boolean>('hover.qaPentest', false) ?? false;
  if (!pool?.run(prompt, sess.agentSessionId, accounts, activeEnv ? { id: activeEnv.id, name: activeEnv.name } : undefined, sourceAccessForRun(), enginePort, isolateContext, qaIntensity, { api: qaApi, pentest: qaPentest }, sess.id)) {
    setSessionRunning(sess, false);
    pushToSession(sess, 'system', 'Could not reach the engine.');
  }
}

/** Append a system/assistant line to a session: render to chat only if it's the
 *  visible one, but always keep it in that session's transcript. */
function pushToSession(sess: ChatSession, kind: 'system' | 'assistant', text: string): void {
  if (kind === 'system') sess.transcript.push({ kind: 'system', text });
  if (sess.id !== activeSessionId) return;
  if (kind === 'system') chatProvider?.pushSystem(text);
  else chatProvider?.pushAssistant(text);
}

/** Ensure `sessionId` has its own connected engine host; return its port (or
 *  undefined if the pool is full of busy sessions / spawn failed). */
async function ensureSessionEngine(sessionId: string): Promise<number | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !extContext || !pool) return undefined;
  try {
    const info = await acquireEngine(extContext, root, sessionId, { busy: busySessions() });
    pool.ensureConnected(info.enginePort);
    const ok = await pool.whenOpen(info.enginePort, 10_000);
    if (!ok) return undefined;
    // A freshly-spawned host starts at default mode/agent/model — re-apply the
    // current settings (broadcasts; idempotent for already-synced hosts) so every
    // session's host matches the user's selection.
    void pushEngineConfig();
    if (currentMode) pool.setMode(currentMode);
    return info.enginePort;
  } catch (e) {
    console.error('[hover] ensureSessionEngine failed:', e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** The source-read grant to start a run with: 'always' skips the per-read gate
 *  (persisted choice); otherwise 'ask' so the engine gates each read through
 *  the approval popup. */
function sourceAccessForRun(): 'always' | 'ask' {
  return extContext?.workspaceState.get<boolean>('hover.sourceAlways') === true ? 'always' : 'ask';
}

/** Show a prompt card for the session that owns it: render now only if that
 *  session is the visible one; otherwise hold it (re-rendered on switch-back by
 *  switchSession) so a background run's prompt never pops in another chat. */
function presentAsk(ownerId: string, req: AskReq): void {
  pendingAsks.set(ownerId, req);
  if (ownerId === activeSessionId) { void chatProvider?.reveal(); chatProvider?.askUser(req); }
}

/** Decide a source-read approval request from the engine: honor a standing
 *  grant, else pop the Always / Once / Deny prompt. */
function handleSourceApproval(msg: ServerMessage, enginePort?: number): void {
  const id = typeof msg.payload?.approvalId === 'string' ? msg.payload.approvalId : undefined;
  if (!id) return;
  const path = typeof msg.payload?.sourcePath === 'string' ? msg.payload.sourcePath : 'source';
  // The grant is per-session (the requesting host's session), so one session's
  // "Allow once" never auto-approves another's reads during a parallel run.
  const owner = sessionById(sessionForPort(enginePort ?? -1));
  const ownerId = owner?.id ?? activeSessionId;
  if (sourceAccessForRun() === 'always' || owner?.sourceGrant === 'allow') { pool?.sendSourceApproval(id, true, enginePort); return; }
  if (owner?.sourceGrant === 'deny') { pool?.sendSourceApproval(id, false, enginePort); return; }
  pendingCards.set(`src:${id}`, (choice) => {
    pendingAsks.delete(ownerId);
    if (choice === 'Always allow') {
      void extContext?.workspaceState.update('hover.sourceAlways', true);
      if (owner) owner.sourceGrant = 'allow';
      pool?.sendSourceApproval(id, true, enginePort);
    } else if (choice === 'Allow once') {
      if (owner) owner.sourceGrant = 'allow';
      pool?.sendSourceApproval(id, true, enginePort);
    } else if (choice === 'Deny') {
      if (owner) owner.sourceGrant = 'deny';
      pool?.sendSourceApproval(id, false, enginePort);
    } else {
      pool?.sendSourceApproval(id, false, enginePort); // dismissed → deny this one, ask again next
    }
  });
  presentAsk(ownerId, {
    askId: `src:${id}`,
    question: `Hover wants to read ${path} to understand the page (read-only, fenced — secrets / .env / .git / node_modules are blocked).`,
    options: [{ label: 'Always allow' }, { label: 'Allow once' }, { label: 'Deny' }],
    other: false,
  });
}

/** Human-in-the-loop: the agent (control MCP `ask_user`) is blocked and needs a
 *  decision/input. Render an in-chat card (question + options + always-present
 *  "Other" free-text); the webview posts the answer back via askAnswerHandler,
 *  which relays it to the engine so the agent continues instead of stopping. */
function handleAskUser(msg: ServerMessage, enginePort?: number): void {
  const id = typeof msg.payload?.askId === 'string' ? msg.payload.askId : undefined;
  if (!id) return;
  const question = typeof msg.payload?.question === 'string' ? msg.payload.question : 'Hover needs your input';
  const rawOptions = Array.isArray(msg.payload?.options) ? (msg.payload.options as { label?: string; description?: string }[]) : [];
  const options = rawOptions.filter((o): o is { label: string; description?: string } => !!o && typeof o.label === 'string');
  const ownerId = sessionForPort(enginePort ?? -1) ?? activeSessionId;
  pendingCards.set(id, (value) => {
    pendingAsks.delete(ownerId);
    // No extra "Answered: …" line — the docked card collapses into the
    // transcript as its own "question → ✓ choice" record.
    pool?.sendAskUserResponse(id, value, enginePort);
  });
  presentAsk(ownerId, { askId: id, question, options });
}

/** Auth-as-fixture (debt 3, Stage 4b): present an in-chat approval card offering
 *  to lift the recorded login into a reusable setup project (which edits the
 *  user's playwright.config). On approval, re-save with the fixture engaged and
 *  show the config edit as an inline diff. "Keep inline" → leave today's spec. */
function offerAuthFixture(owner: ChatSession, specName: string, configPath: string, proposedConfig: string, enginePort?: number): void {
  const askId = `authfix:${specName}:${configPath}`;
  const cfg = configPath.split('/').pop();
  // Match the user's language (their prompt drives the agent's prose too).
  const zh = CJK_RE.test(lastUserPrompt(owner));
  const setLabel = zh ? '抽成 auth fixture' : 'Set up auth fixture';
  pendingCards.set(askId, (value) => {
    if (value !== setLabel) return; // "Keep inline" (or dismissed) → no-op
    void applyAuthFixture(specName, configPath, proposedConfig, enginePort, zh);
  });
  presentAsk(owner.id, {
    askId,
    question: zh
      ? `把这次的登录抽成可复用的 auth fixture 吗？它只跑一次（而非每个测试都登录），你的 spec 直接从已登录态开始。这会修改 ${cfg} 注册一个 setup project，并生成 auth.setup.ts。`
      : `Lift this login into a reusable auth fixture? It runs once (not per test); your specs start logged in. This edits ${cfg} to register a setup project and creates auth.setup.ts.`,
    options: zh
      ? [
          { label: setLabel, description: `修改 ${cfg} + 生成 auth.setup.ts` },
          { label: '保持登录内联', description: '把登录步骤留在每个 spec 里' },
        ]
      : [
          { label: setLabel, description: `Edit ${cfg} + create auth.setup.ts` },
          { label: 'Keep login inline', description: 'Leave the login steps inside each spec' },
        ],
  });
}

/** The most recent user prompt in a session — used to pick the card's language. */
function lastUserPrompt(owner: ChatSession): string {
  for (let i = owner.transcript.length - 1; i >= 0; i--) {
    const t = owner.transcript[i];
    if (t.kind === 'user' && typeof t.text === 'string') return t.text;
  }
  return '';
}
/** Any CJK character → render Hover's prose in Chinese (mirrors agentDirectives). */
const CJK_RE = /[一-鿿]/;

/** Re-save the spec with the auth fixture engaged (the engine applies the config
 *  edit + writes auth.setup.ts), then render the config change as an inline diff. */
async function applyAuthFixture(specName: string, configPath: string, proposedConfig: string, enginePort?: number, zh = false): Promise<void> {
  const cfg = configPath.split('/').pop();
  const stash = fixtureResaves.get(specName);
  if (!stash) {
    chatProvider?.pushSystem(zh ? 'Hover：无法设置 fixture——原始步骤已不可用，请重新保存该 spec。' : 'Hover: could not set up the fixture — original steps are no longer available; re-save the spec.');
    return;
  }
  // Diff against the current config BEFORE the re-save overwrites it.
  let before = '';
  try { before = readFileSync(configPath, 'utf-8'); } catch { /* show the proposal anyway */ }
  pool?.saveSpec(specName, stash.steps, stash.redactions, true, stash.resetRecipe, enginePort, true);
  const diff = additiveConfigDiff(before, proposedConfig);
  chatProvider?.pushSystem(
    (zh
      ? `✓ 已设置 auth fixture——登录抽进了 auth.setup.ts，并在 ${cfg} 注册：`
      : `✓ Set up the auth fixture — lifted login into auth.setup.ts and registered it in ${cfg}:`) +
    `\n\n\`\`\`diff\n${diff}\n\`\`\``,
  );
}

/** Route a captured MITM flow (security/pentest mode) into the Network view. */
function handleFlow(msg: ServerMessage): void {
  if (msg.type === 'security:flows:cleared') { trafficProvider?.clear(); return; }
  if (msg.payload && typeof msg.payload === 'object') trafficProvider?.upsert(msg.payload as unknown as Flow);
}

/** Translate a streamed engine event into chat updates + transcript. Routes by
 *  the message's SOURCE host port to the owning session, so parallel runs never
 *  bleed into each other; the chat UI only renders the visible session's events
 *  (`live`), background sessions accumulate silently in their own transcript. */
function handleServerMessage(msg: ServerMessage, enginePort?: number): void {
  // The session whose host emitted this message (multi-host); falls back to the
  // active one for host-agnostic replies (spec-saved / optimize).
  const owner = sessionById(sessionForPort(enginePort ?? -1)) ?? activeChat();
  const live = owner.id === activeSessionId;

  if (msg.type === 'error') {
    setSessionRunning(owner, false);
    if (live) chatProvider?.pushSystem(String(msg.payload?.message ?? 'error'));
    return;
  }
  if (msg.type === 'source-approval-request') {
    handleSourceApproval(msg, enginePort);
    return;
  }
  if (msg.type === 'ask-user-request') {
    handleAskUser(msg, enginePort);
    return;
  }
  if (msg.type === 'spec-saved') {
    const files = msg.payload?.files;
    if (Array.isArray(files) && files.length > 1) {
      chatProvider?.pushSystem(`Saved ${files.length} specs: ${files.join(', ')}`);
    } else {
      chatProvider?.pushSystem(`Saved spec: ${String(msg.payload?.name ?? '')}`);
    }
    // Auth-as-fixture (debt 3): a login was detected but a user playwright.config
    // exists — offer (in-chat, with approval) to lift login into a setup project.
    const offer = msg.payload?.authFixtureOffer as { configPath?: string; proposedConfig?: string } | undefined;
    if (live && offer?.configPath && offer.proposedConfig) {
      offerAuthFixture(owner, String(msg.payload?.name ?? ''), offer.configPath, offer.proposedConfig, enginePort);
    }
    return;
  }
  // Plugin save handlers (save:pentest:report / save:security:spec) reply with
  // `<type>:saved`. Confirm + open the written artifact.
  if (typeof msg.type === 'string' && msg.type.endsWith(':saved')) {
    const path = typeof msg.payload?.path === 'string' ? msg.payload.path : undefined;
    const isReport = msg.type.includes('report');
    chatProvider?.pushSystem(`Saved ${isReport ? 'findings report' : 'spec'}: ${String(msg.payload?.name ?? path ?? '')}`);
    if (path) void vscode.window.showTextDocument(vscode.Uri.file(path));
    return;
  }
  if (msg.type === 'run-active') {
    setSessionRunning(owner, true);
    return;
  }
  if (msg.type === 'cdp-status') {
    const p = (msg.payload ?? {}) as { state?: string; launching?: boolean };
    if (!p.launching) pendingBrowserByPort.get(enginePort ?? 0)?.(p.state === 'same-window' || p.state === 'wrong-window');
    return;
  }
  if (msg.type === 'heal-ready') {
    // The engine built the heal prompt; run it through the normal run path so
    // the repair streams into chat and crystallizes like any run. The chat shows
    // the short label; the agent receives the full prompt.
    const prompt = String(msg.payload?.prompt ?? '');
    const label = String(msg.payload?.label ?? '🏥 Healing spec');
    if (prompt) void runPrompt(prompt, label);
    return;
  }
  if (msg.type === 'optimize-result') {
    endOptimize();
    const slug = String(msg.payload?.slug ?? '');
    chatProvider?.pushSystem(`Optimized "${slug}" — opening the diff to review.`);
    const uri = pendingOptimizeUri;
    pendingOptimizeUri = undefined;
    if (uri) void openOptimizeDiff(uri, { silentIfMissing: false });
    return;
  }
  if (msg.type === 'optimize-failed') {
    endOptimize();
    pendingOptimizeUri = undefined;
    chatProvider?.pushSystem(`Optimize failed for "${String(msg.payload?.slug ?? '')}": ${String(msg.payload?.reason ?? 'unknown error')}`);
    return;
  }
  if (msg.type === 'screenshot') {
    const sp = msg.payload as { path?: string; full?: boolean } | undefined;
    if (sp?.path) {
      // Persist in the transcript (absolute path) so the thumbnail survives a
      // webview reload / conversation switch — loadSession re-derives a webview
      // URI from the path. Store every shot; the chat coalesces full+viewport.
      owner.transcript.push({ kind: 'shot', path: sp.path, full: !!sp.full });
      if (live) chatProvider?.pushScreenshot(sp.path, !!sp.full);
    }
    return;
  }
  if (msg.type === 'qa-report') {
    // A QA run wrote its findings report — surface a clickable link in the chat
    // (click → open the .md in the editor). Persisted so it survives reload.
    const rp = msg.payload as { path?: string } | undefined;
    if (rp?.path) {
      owner.transcript.push({ kind: 'report', path: rp.path });
      if (live) chatProvider?.pushReport(rp.path);
      persistSessions(); // arrives AFTER the run's `done` → re-persist or it's lost on reload
    }
    return;
  }
  if (msg.type === 'qa-candidates') {
    // QA Stage 4: the run surfaced candidate flows (each already resolved to its
    // real recorded steps). Persist them so the cards survive reload, and render
    // a ✨ Crystallize card per candidate in the chat.
    const cp = msg.payload as { candidates?: QaCandidate[] } | undefined;
    const cands = Array.isArray(cp?.candidates) ? cp!.candidates : [];
    if (cands.length) {
      owner.transcript.push({ kind: 'candidates', candidates: cands });
      if (live) chatProvider?.pushCandidates(cands);
      persistSessions(); // arrives AFTER the run's `done` → re-persist or it's lost on reload
    }
    return;
  }
  if (msg.type === 'reset-recipe') {
    // Recon (debt-2 reproducible-state-isolation) discovered how to reset this
    // app to a clean state — persist it onto the env record so future runs and
    // the resetState() codegen reuse it. Best-effort; keyed to the run's env.
    const rp = msg.payload as { envId?: string; recipe?: ResetRecipe } | undefined;
    if (rp?.envId && rp.recipe && typeof rp.recipe.tier === 'number') {
      void envStore?.setResetRecipe(rp.envId, rp.recipe);
    }
    return;
  }
  if (msg.type !== 'event') return;
  const ev = msg.payload as { kind?: string; [k: string]: unknown } | undefined;
  switch (ev?.kind) {
    case 'session_start':
      if (typeof ev.sessionId === 'string') { owner.agentSessionId = ev.sessionId; persistSessions(); }
      setSessionRunning(owner, true);
      break;
    case 'tool_use': {
      owner.transcript.push({ kind: 'step', tool: ev.tool, input: ev.input, label: humanizeTool(String(ev.tool ?? ''), ev.input) });
      // Per-run saveable-action counter (reset to 0 at run start). Only real
      // browser actions count — gates the Done-vs-clarify branch + the Save prompt.
      if (isSaveableTool(ev.tool)) owner.stepCount = (owner.stepCount ?? 0) + 1;
      if (typeof ev.costUsdSnapshot === 'number') owner.runCost = ev.costUsdSnapshot;
      if (typeof ev.tokensSnapshot === 'number') owner.runTokens = ev.tokensSnapshot;
      if (!live) break;
      let detail = '';
      try {
        detail = ev.input == null ? '{}' : JSON.stringify(ev.input);
      } catch {
        detail = String(ev.input);
      }
      chatProvider?.pushStep({
        label: humanizeTool(String(ev.tool ?? ''), ev.input),
        tool: String(ev.tool ?? ''),
        detail,
        cost: typeof ev.costUsdSnapshot === 'number' ? ev.costUsdSnapshot : undefined,
        tokens: typeof ev.tokensSnapshot === 'number' ? ev.tokensSnapshot : undefined,
      });
      break;
    }
    case 'tool_result': {
      // Mark the step this result belongs to as failed, so writeSpec drops the
      // agent's failed attempts from the saved spec (mirrors runSession's
      // server-side marking — the Save path crystallizes this transcript, not
      // runSession's steps, so without this the dirty-recording filter is inert
      // on the extension's primary path).
      if (ev.isError) {
        for (let i = owner.transcript.length - 1; i >= 0; i--) {
          if (owner.transcript[i].kind === 'step') { owner.transcript[i].isError = true; break; }
        }
      }
      break;
    }
    case 'usage':
      if (typeof ev.costUsd === 'number') owner.runCost = ev.costUsd;
      if (typeof ev.tokens === 'number') { owner.runTokens = ev.tokens; if (live) chatProvider?.pushUsage(ev.tokens); }
      break;
    case 'text':
      if (typeof ev.text === 'string' && ev.text.trim()) {
        owner.transcript.push({ kind: 'ai', text: ev.text });
        if (live) chatProvider?.pushNarration(ev.text);
      }
      break;
    case 'session_end': {
      // `stepCount` is the per-run saveable-action counter — reset at run start,
      // incremented only on saveable tools — so it's run-scoped by construction
      // and can't be inflated by an earlier turn's actions. Gates the
      // Done-vs-clarification branch + the Save prompt.
      const steps = owner.stepCount ?? 0;
      owner.transcript.push({ kind: 'done', summary: ev.summary, isError: ev.isError, findings: ev.findings, mode: currentMode, steps, tokens: owner.runTokens ?? 0 });
      // If this run ended by asking the user to choose (a hover-ask block), the
      // task isn't done — carry the saveable-step count into the follow-up run so
      // its closing wrap-up keeps the Done card instead of degrading to a plain
      // reply. Only on a clean ask (not an error/cancel).
      owner.carryStepCount = !ev.isError && !ev.cancelled && endsWithHoverAsk(String(ev.summary ?? ''));
      persistSessions();
      if (typeof ev.costUsd === 'number') owner.runCost = ev.costUsd;
      if (typeof ev.tokens === 'number') owner.runTokens = ev.tokens;
      setSessionRunning(owner, false);
      if (!live) {
        // Background session finished — a quiet toast so the user knows to look,
        // without disturbing the conversation they're watching.
        if (ev.isError) void vscode.window.showWarningMessage(`Hover: session "${owner.name}" ended with an error.`);
        else void vscode.window.showInformationMessage(`Hover: session "${owner.name}" finished.`);
        break;
      }
      if (ev.cancelled) {
        chatProvider?.pushSystem('Run cancelled.');
      } else if (ev.isError) {
        const summary = String(ev.summary ?? '');
        chatProvider?.pushSystem(`Run ended with an error: ${summary}`);
        if (/cdp|chrome|debug|9222|connect|browser/i.test(summary)) {
          chatProvider?.pushSystem('No app browser detected — click "▶ Start App" (in the chat) to start your dev server + browser.');
        }
      } else if (steps === 0) {
        // No browser actions — the agent just replied (e.g. a vague prompt).
        // Don't fake a PASS; show it as a plain reply.
        chatProvider?.pushAssistant(String(ev.summary ?? 'Done.'));
      } else {
        // "Done" not "PASS": the run finished and here's the summary — it is
        // not a test-pass assertion (the agent may have logged real bugs in
        // ## Findings). PASS read as a green light even when issues existed.
        chatProvider?.pushResult('Done', String(ev.summary ?? 'Done.'), steps, owner.runCost ?? 0, owner.runTokens ?? 0, Array.isArray(ev.findings) ? ev.findings : undefined, currentMode);
        // No auto-save: the user decides whether to crystallize this run (the
        // result card offers it; saving runs via the Hover: Save command).
      }
      break;
    }
  }
}

/** Short, human label for a browser/MCP tool call. */
function humanizeTool(rawTool: string, input: unknown): string {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  // Non-playwright MCP tools (e.g. the fenced source reader) keep their
  // mcp__<server>__ prefix; strip it so the switch + fallback read cleanly.
  const tool = rawTool.replace(/^mcp__[a-z0-9_]+__/, '');
  const base = (p: string): string => p.split(/[\\/]/).pop() || p;
  switch (tool) {
    case 'check_control': return `${i.checked === false ? 'Clear' : 'Select'} ${s(i.name) || s(i.role) || 'control'}`;
    case 'read_source': return `📄 Read source: ${base(s(i.path))}`.trim();
    case 'list_source': return `📄 Browse source${i.path ? ': ' + base(s(i.path)) : ''}`;
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

// ── App / dev-server status ───────────────────────────────────────────────
// The top-right pill reflects whether the project's dev server is reachable.
// With no configured URL we auto-probe common dev ports and show the first
// that responds; a configured URL is probed directly.
const COMMON_DEV_URLS = [
  'http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174',
  'http://localhost:4321', 'http://localhost:8080', 'http://localhost:4200',
  'http://localhost:5000', 'http://localhost:8000', 'http://localhost:1420',
];
let appStatusTimer: ReturnType<typeof setInterval> | undefined;
/** Re-entrancy guard: a full local probe sweep can take ~13s (9 × 1.5s) when
 *  nothing responds, longer than the 5s interval — without this, sweeps stack
 *  and race on detectedUrl / the pill. */
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
    let online = false;
    let target: string | null = null;
    let label: string | null = null;

    if (isLocal) {
      const configured = vscode.workspace.getConfiguration('hover').get<string>('appUrl');
      const candidates = configured ? [configured] : COMMON_DEV_URLS;
      for (const u of candidates) {
        if (await probeUrl(u)) { target = u; break; }
      }
      online = Boolean(target);
      detectedUrl = target ?? (configured || null);
      target = target ?? configured ?? null;
      label = target ? target.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
    } else {
      target = active.url;
      online = await probeUrl(active.url);
      label = active.name;
    }
    chatProvider?.updateApp(online, label, target ?? undefined);
  } finally {
    appStatusPolling = false;
  }
}

/** Top-right pill click: switch the active environment, or start / set local. */
async function appStatus(): Promise<void> {
  const envs = (await envStore?.load()) ?? [];
  const activeId = envStore?.getActiveId();
  type Item = vscode.QuickPickItem & { envId?: string; action?: string };
  const items: Item[] = envs.map((e) => ({
    label: `${e.id === activeId ? '$(circle-large-filled)' : '$(circle-large-outline)'} ${e.name}`,
    description: e.url.replace(/^https?:\/\//, '').replace(/\/$/, '') + (e.id === LOCAL_ENV_ID ? '' : e.verified ? '  ✓' : '  ⚠ unverified'),
    envId: e.id,
  }));
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: '$(rocket) Start App', description: 'dev server + browser', action: 'start' });
  items.push({ label: '$(refresh) Reopen browser', description: 'relaunch the debug Chrome (if closed / no window appeared)', action: 'reopen' });
  items.push({ label: '$(link) Set local URL…', description: 'manually set the dev server URL', action: 'set' });
  items.push({ label: '$(gear) Manage environments…', action: 'manage' });

  const pick = await vscode.window.showQuickPick(items, { title: 'Hover — target environment' });
  if (!pick) return;
  if (pick.action === 'start') await startApp();
  else if (pick.action === 'reopen') await reopenBrowser();
  else if (pick.action === 'manage') {
    await vscode.commands.executeCommand('workbench.view.extension.hover');
    await vscode.commands.executeCommand('hover.environments.focus');
  } else if (pick.action === 'set') {
    const cfg = vscode.workspace.getConfiguration('hover');
    const url = await vscode.window.showInputBox({
      title: 'Hover: local app URL',
      prompt: 'Your dev server URL',
      value: cfg.get<string>('appUrl') || 'http://localhost:5173',
    });
    if (url !== undefined) {
      await cfg.update('appUrl', url, vscode.ConfigurationTarget.Workspace);
      void pollAppStatus();
    }
  } else if (pick.envId) {
    await envStore?.setActiveId(pick.envId);
    void pollAppStatus();
  }
}

// ── Start App: dev server + debug browser ─────────────────────────────────
let devTerminal: vscode.Terminal | undefined;

/** Silent (headless) vs visible (headed) browser — the user's toggle. */
function isSilent(): boolean {
  return vscode.workspace.getConfiguration('hover').get<string>('browser', 'silent') !== 'visible';
}

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

async function getAppUrl(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('hover');
  let url = cfg.get<string>('appUrl');
  if (!url) {
    url = await vscode.window.showInputBox({
      title: 'Hover: app URL',
      prompt: 'Your dev server URL (saved for next time)',
      value: 'http://localhost:5173',
    });
    if (url) await cfg.update('appUrl', url, vscode.ConfigurationTarget.Workspace);
  }
  return url || undefined;
}

/** Start the project's dev server (if not already) + launch the debug browser. */
async function startApp(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('Hover: open a project folder first.');
    return;
  }
  // Launch into the ACTIVE session's own browser (its own host/profile).
  const enginePort = (await ensureSessionEngine(activeSessionId)) ?? activeEnginePort();
  // A remote environment (staging/prod) has no local dev server to spawn — just
  // point the browser at its URL.
  const active = await envStore?.getActive();
  if (active && active.id !== LOCAL_ENV_ID) {
    const silent = isSilent();
    if (pool?.launchChrome(active.url, silent, false, enginePort)) {
      chatProvider?.pushSystem(`Browser ${silent ? 'running headless (no window)' : 'opened'} at ${active.name} (${active.url}).`);
    } else {
      chatProvider?.pushSystem('Could not launch the browser — the engine may still be starting.');
    }
    return;
  }

  const url = await getAppUrl();
  if (!url) return;

  let startedServer = false;
  if (!devTerminal) {
    const script = await pickDevScript(root);
    if (script) {
      const pm = detectPackageManager(root);
      devTerminal = vscode.window.createTerminal({ name: 'Hover Dev Server', cwd: root });
      devTerminal.show(true);
      devTerminal.sendText(`${pm} run ${script}`);
      startedServer = true;
      chatProvider?.pushSystem(`Starting dev server (${pm} run ${script})…`);
    }
  }
  // Give a freshly-started server a moment before pointing Chrome at it.
  if (startedServer) await new Promise((r) => setTimeout(r, 3500));

  const silent = isSilent();
  if (pool?.launchChrome(url, silent, false, enginePort)) {
    chatProvider?.pushSystem(`Browser ${silent ? 'running headless (no window)' : 'opened'} at ${url}.`);
  } else {
    chatProvider?.pushSystem('Could not launch the browser — the engine may still be starting.');
  }
}

/** Flip silent ↔ visible and relaunch the browser to match. */
async function toggleBrowser(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('hover');
  const next = isSilent() ? 'visible' : 'silent';
  await cfg.update('browser', next, vscode.ConfigurationTarget.Workspace);
  pushChatConfig();
  settingsProvider?.refresh();
  const url = await resolveTargetUrl();
  // force: the launcher is idempotent on the port, so without this a
  // headless↔visible switch would no-op (the old-mode Chrome keeps running and
  // a "visible" window never appears). force closes + relaunches in the new mode.
  if (url && pool?.launchChrome(url, next === 'silent', true, activeEnginePort())) {
    chatProvider?.pushSystem(`Browser mode: ${next === 'silent' ? 'Headless' : 'Normal'} — relaunched at ${url}.`);
  } else {
    void vscode.window.showInformationMessage(`Hover browser mode: ${next}. Takes effect on the next launch.`);
  }
}

/** Reopen the debug browser at the current target in the current mode — for
 *  when it was closed (or a visible window didn't appear). force-relaunches so
 *  it comes back even if a stale instance is still on the CDP port. */
async function reopenBrowser(): Promise<void> {
  const url = await resolveTargetUrl();
  if (!url) {
    void vscode.window.showWarningMessage('Hover: no target URL — set one or start your dev server first.');
    return;
  }
  if (pool?.launchChrome(url, isSilent(), true, activeEnginePort())) {
    chatProvider?.pushSystem(`Browser ${isSilent() ? 'running headless (no window)' : 'reopened'} at ${url}.`);
  } else {
    void vscode.window.showWarningMessage('Hover: could not reach the engine to reopen the browser.');
  }
}


async function saveSpec(nameArg?: string, overwrite = false): Promise<void> {
  // Save crystallizes the VISIBLE session's last run.
  const tx = activeChat().transcript;
  let idx = -1;
  for (let i = tx.length - 1; i >= 0; i--) if (tx[i].kind === 'user') { idx = i; break; }
  const steps = idx === -1 ? tx.slice() : tx.slice(idx);
  if (!steps.some((m) => m.kind === 'step')) {
    void vscode.window.showWarningMessage('Hover: nothing to save — no steps in the last run.');
    return;
  }
  // Guarantee the spec opens the app. The agent usually connects to an
  // already-open debug-Chrome tab and never calls browser_navigate, so the
  // recording can have no navigation — the saved spec would then run against
  // about:blank and fail on the first locator. Prepend a goto from the run's
  // target when none was captured (idempotent: only added if missing).
  if (!steps.some((m) => m.kind === 'step' && m.tool === 'browser_navigate')) {
    const url = await resolveTargetUrl();
    if (url) steps.unshift({ kind: 'step', tool: 'browser_navigate', input: { url } });
  }
  const name = nameArg ?? await vscode.window.showInputBox({ title: 'Save as Playwright spec', prompt: 'Spec name', placeHolder: 'login-flow' });
  if (!name) return;
  // Parameterize any @-mentioned account credentials this run used into
  // process.env refs so the saved spec never holds the literal secret.
  const redactions: { value: string; envVar: string }[] = [];
  for (const a of activeChat().lastAccounts ?? []) {
    if (a.username) redactions.push({ value: a.username, envVar: a.userEnvVar });
    if (a.password) redactions.push({ value: a.password, envVar: a.passEnvVar });
  }
  // Debt-2: a tier-1 reset recipe on the active env makes the spec re-enter from
  // a clean client state (resetState() beforeEach). Recon populates it; absent
  // here → no reset emitted.
  const resetRecipe = (await envStore?.getActive())?.resetRecipe;
  // Stash for a possible auth-fixture re-save (debt 3): if the engine reports a
  // login + an existing config, the approval card re-saves these same params.
  fixtureResaves.set(name, { steps, redactions, resetRecipe });
  if (!pool?.saveSpec(name, steps, redactions, overwrite, resetRecipe)) void vscode.window.showWarningMessage('Hover: engine not connected.');
}

/** A QA candidate flow surfaced at run end — its steps are already resolved to
 *  the real recorded hover-control actuations (record==replay), so crystallizing
 *  is just writeSpec over those steps. */
interface QaCandidate {
  name: string;
  description?: string;
  steps: { kind: string; tool?: string; input?: unknown }[];
  stepCount?: number;
}

/** ✨ Crystallize one QA candidate flow into a standalone Playwright spec. Unlike
 *  saveSpec (which slices the whole last run from the transcript), a candidate
 *  already carries its exact steps — so we write just those, after the same
 *  goto-prepend + credential-redaction the normal save path applies. */
async function crystallizeCandidate(candidateName: string, rawSteps: unknown[]): Promise<void> {
  const steps = (rawSteps as QaCandidate['steps']).filter((s) => s && typeof s === 'object');
  if (!steps.some((m) => m.kind === 'step')) {
    void vscode.window.showWarningMessage('Hover: this candidate flow has no replayable steps.');
    return;
  }
  // Guarantee the spec opens the app (the run usually had no browser_navigate —
  // it connected to an already-open tab). Idempotent: only added if missing.
  if (!steps.some((m) => m.kind === 'step' && m.tool === 'browser_navigate')) {
    const url = await resolveTargetUrl();
    if (url) steps.unshift({ kind: 'step', tool: 'browser_navigate', input: { url } });
  }
  const name = await vscode.window.showInputBox({
    title: 'Crystallize candidate flow',
    prompt: 'Spec name',
    value: candidateName,
  });
  if (!name) return;
  const redactions: { value: string; envVar: string }[] = [];
  for (const a of activeChat().lastAccounts ?? []) {
    if (a.username) redactions.push({ value: a.username, envVar: a.userEnvVar });
    if (a.password) redactions.push({ value: a.password, envVar: a.passEnvVar });
  }
  const resetRecipe = (await envStore?.getActive())?.resetRecipe;
  fixtureResaves.set(name, { steps, redactions, resetRecipe });
  if (!pool?.saveSpec(name, steps, redactions, false, resetRecipe)) void vscode.window.showWarningMessage('Hover: engine not connected.');
}

/** 🔴 pentest mode: crystallize the session's recorded probes into a Markdown
 *  findings report via the pentest plugin's save handler — NOT a Playwright
 *  spec (an attack run is not a regression artifact). */
async function saveFindingsReport(nameArg?: string, _overwrite = false): Promise<void> {
  if (!pool || connectedServices === 0) {
    void vscode.window.showWarningMessage('Hover: engine not connected.');
    return;
  }
  const name = nameArg ?? await vscode.window.showInputBox({ title: 'Save findings report', prompt: 'Report name', placeHolder: 'scan' });
  if (!name) return;
  // Report lives in the active session's host (its mode runtime accumulated the
  // findings). Target it so we save THAT session's pentest, not another's.
  if (!pool.pluginSave('save:pentest:report', { name }, activeEnginePort())) {
    void vscode.window.showWarningMessage('Hover: engine not connected.');
  }
}

/** 🟠 api-test mode: crystallize the recorded API checks (replay_flow /
 *  api_request with intent + expectStatus) into a plain `request.*`
 *  `.api-test.spec.ts` via the api-test plugin's save handler — NOT the
 *  browser-step writer (an API test must be UI-independent). */
async function saveApiTestSpec(nameArg?: string, overwrite = false): Promise<void> {
  if (!pool || connectedServices === 0) {
    void vscode.window.showWarningMessage('Hover: engine not connected.');
    return;
  }
  const name = nameArg ?? await vscode.window.showInputBox({ title: 'Save as API-test spec', prompt: 'Spec name', placeHolder: 'api-contract' });
  if (!name) return;
  if (!pool.pluginSave('save:security:spec', { name, overwrite }, activeEnginePort())) {
    void vscode.window.showWarningMessage('Hover: engine not connected — or no API checks recorded this run (use api_request / replay_flow with intent + expectStatus).');
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extContext = context;
  // Pentest is OFFENSIVE — it must never stay silently armed across sessions.
  // Reset it OFF on every activation so QA always defaults to API (non-
  // destructive); the user re-enables + re-confirms pentest per session.
  void context.globalState.update('hover.qaPentest', false);
  context.subscriptions.push(
    vscode.commands.registerCommand('hover.reviewOptimizationCandidate', (arg?: vscode.TreeItem | vscode.Uri) =>
      reviewOptimizationCandidate(arg),
    ),
    vscode.commands.registerCommand('hover.openSource', (source?: string) => openSource(source)),
    vscode.commands.registerCommand('hover.runSpec', (item?: vscode.TreeItem | vscode.Uri) => runSpec(item)),
    vscode.commands.registerCommand('hover.runFolderSpecs', (item?: vscode.TreeItem) => runFolderSpecs(item)),
    vscode.commands.registerCommand('hover.runAllSpecs', () => runAllSpecs()),
    vscode.commands.registerCommand('hover.resetSourceAccess', async () => {
      await extContext?.workspaceState.update('hover.sourceAlways', false);
      for (const s of sessions) s.sourceGrant = undefined;
      void vscode.window.showInformationMessage('Hover: source-read permission reset — you\'ll be asked again next time.');
    }),
    vscode.commands.registerCommand('hover.switchMode', () => switchMode()),
    vscode.commands.registerCommand('hover.switchAgent', () => switchAgent()),
    vscode.commands.registerCommand('hover.newSession', () => newSession()),
    vscode.commands.registerCommand('hover.saveSpec', () => saveSpec()),
    vscode.commands.registerCommand('hover.saveFindingsReport', () => saveFindingsReport()),
    vscode.commands.registerCommand('hover.cancelRun', () => pool?.cancel(activeEnginePort())),
    vscode.commands.registerCommand('hover.optimizeSpec', (a?: vscode.TreeItem | vscode.Uri) => optimizeSpec(a)),
    vscode.commands.registerCommand('hover.healSpec', (a?: vscode.TreeItem | vscode.Uri) => healSpec(a)),
    vscode.commands.registerCommand('hover.addCiWorkflow', () => addCiWorkflow()),
    vscode.commands.registerCommand('hover.startApp', () => startApp()),
    vscode.commands.registerCommand('hover.toggleBrowser', () => toggleBrowser()),
    vscode.commands.registerCommand('hover.reopenBrowser', () => reopenBrowser()),
    vscode.commands.registerCommand('hover.appStatus', () => appStatus()),
    vscode.window.onDidCloseTerminal((t) => {
      if (t === devTerminal) devTerminal = undefined;
    }),
    vscode.commands.registerCommand('hover.openRepo', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/Hyperyond/Hover')),
    ),
    vscode.commands.registerCommand('hover.openSite', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://www.gethover.dev/')),
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
  const chat = registerChatView(context.extensionUri);
  chatProvider = chat.provider;
  loadSessions(); // restore persisted conversations (or seed one)
  chatProvider.runHandler = (prompt) => void runPrompt(prompt);
  // The user confirmed the after-run save prompt (filename entered in-chat).
  chatProvider.saveRunHandler = (name, mode) => void (
    mode === 'pentest' ? saveFindingsReport(name)
    : mode === 'api-test' ? saveApiTestSpec(name)
    : saveSpec(name));
  // The user clicked a QA report link in the chat → open the .md in the editor.
  chatProvider.openReportHandler = (path) =>
    void vscode.window.showTextDocument(vscode.Uri.file(path)).then(undefined, () =>
      vscode.window.showWarningMessage(`Hover: could not open ${path}`),
    );
  // The user clicked ✨ Crystallize on a QA candidate flow → write its steps to a spec.
  chatProvider.crystallizeCandidateHandler = (name, steps) => void crystallizeCandidate(name, steps);
  // The user picked a QA intensity (quick/standard/deep) — persist it; runPrompt
  // sends it with each run and the engine applies it in QA mode.
  chatProvider.qaIntensityHandler = (value) => {
    void extContext?.globalState.update('hover.qaIntensity', value);
    chatProvider?.pushQaIntensity(value); // echo so the composer picker reflects it
  };
  // The user toggled QA's API capability — persist it; runPrompt sends it and
  // the engine composes the api-test runtime when on (+ available).
  chatProvider.qaApiHandler = (value) => {
    void extContext?.globalState.update('hover.qaApi', value);
    chatProvider?.pushQaApi(value); // echo so the toggle flips in the UI
  };
  // Pentest is OFFENSIVE — enabling it confirms first (own-app only). It can run
  // alongside API: the engine sequences them as two phases (verify, then pentest)
  // so the destructive pass runs last. Disabling needs no confirm.
  chatProvider.qaPentestHandler = (value) => {
    if (!value) {
      void extContext?.globalState.update('hover.qaPentest', false);
      chatProvider?.pushQaPentest(false);
      return;
    }
    void vscode.window
      .showWarningMessage(
        'Enable Pentest in QA? This runs REAL attacks (injection, IDOR, SSRF, …) against the app under test. Only enable for an app you own and are authorized to test. If API is also on, Hover runs functional + API first, then pentest last.',
        { modal: true },
        'Enable Pentest',
      )
      .then((pick) => {
        if (pick === 'Enable Pentest') {
          void extContext?.globalState.update('hover.qaPentest', true);
          chatProvider?.pushQaPentest(true);
        } else {
          chatProvider?.pushQaPentest(false); // revert the toggle in the UI
        }
      });
  };
  // The user switched the active conversation from the top-bar switcher.
  chatProvider.sessionSwitchHandler = (id) => switchSession(id);
  // The user answered an in-chat prompt card → run that card's resolver
  // (ask_user → relay to engine; source-approval → allow/deny).
  chatProvider.askAnswerHandler = (askId, value) => {
    const cb = pendingCards.get(askId);
    pendingCards.delete(askId);
    if (cb) cb(value);
  };
  // Mode picked from the chat popup → apply (same as the QuickPick path).
  chatProvider.modeHandler = (modeId) => {
    currentMode = modeId;
    renderModeStatus();
    chatProvider?.updateMode(currentMode, currentMode ? modeLabel(currentMode) : null);
    if (connectedServices > 0) pool?.setMode(modeId);
  };
  // Model picked from the chat popup → persist + push to the engine. Disabled
  // models (e.g. Fable 5, not yet selectable) are ignored.
  chatProvider.modelHandler = (value) => {
    void (async () => {
      const entry = modelsForAgent(activeAgentId()).find((m) => m.value === value);
      if (!entry || entry.disabled) return;
      await safeUpdate('model', value);
      pool?.setModel(value);
      await pushModels();
    })();
  };
  // Reasoning-effort picked from the chat model menu → persist + push.
  chatProvider.effortHandler = (value) => void setEffort(value);
  // Re-sync state whenever the chat webview (re)loads — otherwise the initial
  // pushes race the view's first resolve and get dropped.
  chatProvider.onReady = () => {
    pushChatConfig();
    void pushAccounts();
    void pushModels();
    void pollAppStatus();
    chatProvider?.pushQaIntensity(extContext?.globalState.get<string>('hover.qaIntensity', 'standard') ?? 'standard');
    chatProvider?.pushQaApi(extContext?.globalState.get<boolean>('hover.qaApi', true) ?? true);
    chatProvider?.pushQaPentest(extContext?.globalState.get<boolean>('hover.qaPentest', false) ?? false);
    chatProvider?.pushQaCapabilityAvailability(apiCapabilityAvailable, pentestCapabilityAvailable);
    if (currentMode) chatProvider?.updateMode(currentMode, modeLabel(currentMode));
    // Restore the session switcher + the active conversation's transcript.
    pushSessionList();
    if (activeChat().transcript.length) chatProvider?.loadSession(activeChat().transcript);
  };

  const settings = registerSettingsView(context.extensionUri, {
    getAgents: () => ({ current: activeAgentId(), list: allAgents() }),
    getByok: () => readByok(),
    getAgentContext: () => extContext?.globalState.get<string>('hover.agentContext', 'shared') ?? 'shared',
    getSpeechVoices: () => ({
      zh: extContext?.globalState.get<string>('hover.speechVoiceZh', '') ?? '',
      en: extContext?.globalState.get<string>('hover.speechVoiceEn', '') ?? '',
    }),
    onChange: async (change) => {
      const cfg = vscode.workspace.getConfiguration('hover');
      if (typeof change.agent === 'string') await setAgent(change.agent);
      if (typeof change.speech === 'boolean') await safeUpdate('speech', change.speech, vscode.ConfigurationTarget.Global);
      // Narration voice choices (globalState, like agentContext) → push to chat.
      if (typeof change.voiceZh === 'string') { await extContext?.globalState.update('hover.speechVoiceZh', change.voiceZh); pushChatConfig(); }
      if (typeof change.voiceEn === 'string') { await extContext?.globalState.update('hover.speechVoiceEn', change.voiceEn); pushChatConfig(); }
      if (typeof change.browser === 'string') await safeUpdate('browser', change.browser);
      // Memory mode lives in extension globalState, NOT VS Code config: config
      // scope precedence (a stale Workspace value outranking Global) made the
      // dropdown snap back. globalState is extension-owned, always writable, no
      // precedence — so it sticks. refresh() re-reads it into the dropdown.
      if (typeof change.agentContext === 'string') {
        await extContext?.globalState.update('hover.agentContext', change.agentContext);
        settingsProvider?.refresh();
      }
      if (typeof change.model === 'string') {
        await safeUpdate('model', change.model);
        pool?.setModel(change.model);
        await pushModels(); // keep the chat model button in sync
      }
      if (typeof change.localBaseUrl === 'string') {
        await safeUpdate('localBaseUrl', change.localBaseUrl);
        pool?.setLocalEndpoint(change.localBaseUrl);
      }
      if (typeof change.localModel === 'string') {
        await safeUpdate('localModel', change.localModel);
        await pushModels(); // pushes the local model to the engine when qwen is active
      }
      // ── BYOK ──────────────────────────────────────────────────────────
      if (change.modelSource === 'cli' || change.modelSource === 'byok') await safeUpdate('modelSource', change.modelSource);
      if (typeof change.byokProtocol === 'string') { await safeUpdate('byok.protocol', change.byokProtocol); settingsProvider?.refresh(); }
      if (typeof change.byokGateway === 'string') await safeUpdate('byok.gateway', change.byokGateway);
      if (typeof change.byokBaseUrl === 'string') await safeUpdate('byok.baseUrl', change.byokBaseUrl);
      if (typeof change.byokModel === 'string') await safeUpdate('byok.model', change.byokModel);
      if (typeof change.byokMaxTokens === 'number') await safeUpdate('byok.maxTokens', change.byokMaxTokens);
      if (typeof change.byokApiKey === 'string') {
        const proto = cfg.get<string>('byok.protocol', 'anthropic');
        const sk = byokSecretKey(proto);
        if (change.byokApiKey) await extContext?.secrets.store(sk, change.byokApiKey);
        else await extContext?.secrets.delete(sk);
        settingsProvider?.refresh();
      }
      // Any model-source / byok change re-pushes the active config to the engine.
      if (
        change.modelSource !== undefined || change.byokProtocol !== undefined || change.byokGateway !== undefined ||
        change.byokBaseUrl !== undefined || change.byokModel !== undefined || change.byokMaxTokens !== undefined ||
        change.byokApiKey !== undefined || change.agent !== undefined
      ) await pushByok();
      if (change.rescan) pool?.refreshAgents();
      pushChatConfig();
    },
  });
  settingsProvider = settings.provider;
  envStore = new EnvironmentStore(context);
  envStore.onDidChange(() => void pushAccounts());
  const conversations = registerConversationsView(context.extensionUri, {
    onSwitch: (id) => switchSession(id),
    onNew: () => void newSession(),
    onRename: (id, name) => renameSession(id, name),
    onDelete: (id) => void deleteSession(id),
  });
  conversationsProvider = conversations.provider;
  const traffic = registerTrafficView(context.extensionUri);
  trafficProvider = traffic.provider;
  context.subscriptions.push(
    chat.disposable,
    settings.disposable,
    ...registerDashboardView(context.extensionUri),
    ...conversations.disposables,
    ...traffic.disposables,
    ...registerEnvironmentsView(envStore, () => {
      void pollAppStatus();
      void pushAccounts();
    }),
  );
  pushSessionList(); // seed the chat switcher + Conversations sidebar

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
      const was = connectedServices;
      connectedServices = connected;
      renderModeStatus();
      if (was === 0 && connected > 0) void pushEngineConfig();
    },
    onModes: (current, available, caps) => {
      currentMode = current;
      availableModes = available;
      apiCapabilityAvailable = caps?.api === true;
      pentestCapabilityAvailable = caps?.pentest === true;
      renderModeStatus();
      chatProvider?.updateMode(currentMode, currentMode ? modeLabel(currentMode) : null);
      chatProvider?.pushQaCapabilityAvailability(apiCapabilityAvailable, pentestCapabilityAvailable);
    },
    onAgents: (current, available) => {
      currentAgent = current;
      availableAgents = available;
      settingsProvider?.refresh();
      void pushModels(); // agent may have changed → re-push the right model list
    },
    onServerMessage: (msg, port) => handleServerMessage(msg, port),
    onFlow: (msg) => handleFlow(msg),
  });
  context.subscriptions.push({ dispose: () => pool?.dispose() });

  // Self-contained (Path A): boot the engine in-extension so the WS pool
  // connects with no bundler plugin / dev server. Fire-and-forget; the pool
  // connects when it's up. A missing staged engine (e.g. dev build before
  // `stage:engine`) just leaves the extension in connect-when-available mode.
  void bootEngine(context, false);

  // Poll the dev-server status for the top-right pill (auto-probe common ports
  // when no URL is configured).
  void pollAppStatus();
  appStatusTimer = setInterval(() => void pollAppStatus(), 5000);
  context.subscriptions.push({ dispose: () => { if (appStatusTimer) clearInterval(appStatusTimer); } });

  // Initial config → chat (voice + silent-run border) + accounts for @-mentions
  // + the model picker list for the active agent.
  pushChatConfig();
  void pushAccounts();
  void pushModels();

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
  if (optimizeTimer) { clearTimeout(optimizeTimer); optimizeTimer = undefined; }
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
    // Boot the active session's host eagerly so modes / agents / status flow on
    // open (additional sessions spawn their own host lazily on first run).
    const info = await acquireEngine(ctx, root, activeChat().id);
    pool?.ensureConnected(info.enginePort);
    if (announce) void vscode.window.showInformationMessage(`Hover engine running on 127.0.0.1:${info.enginePort}.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Quiet on auto-start (the staged engine may be absent in dev); loud on demand.
    if (announce) void vscode.window.showErrorMessage(`Hover engine failed to start: ${msg}`);
    else console.error('[hover] engine auto-start failed:', msg);
  }
}

function renderModeStatus(): void {
  // Gate the Network view: only security / pentest (currentMode != null) run the
  // MITM proxy, so the view is shown only then (package.json `when`).
  void vscode.commands.executeCommand('setContext', 'hover.modeActive', currentMode !== null);
  if (!modeStatus) return;
  const label = currentMode ? modeLabel(currentMode) : null;
  const disconnected = connectedServices === 0;
  modeStatus.text = `$(sparkle) Hover${label ? `: ${label}` : ''}${disconnected ? ' $(circle-slash)' : ''}`;
  modeStatus.backgroundColor =
    currentMode === 'pentest'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : currentMode === 'api-test'
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
    { label: '$(circle-outline) Flow', description: 'drive the flow you describe → one Playwright spec', modeId: null },
    ...allModes().map((m) => ({
      label: `${m.id === 'pentest' ? '$(flame)' : m.id === 'qa' ? '$(search)' : '$(shield)'} ${m.label}`,
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
  await setAgent(picked.agentId);
}

/** Persist + apply the coding agent (used by the command + the Settings panel). */
async function setAgent(agentId: string): Promise<void> {
  currentAgent = agentId;
  await safeUpdate('agent', agentId);
  if (connectedServices > 0) pool?.switchAgent(agentId);
  settingsProvider?.refresh();
  await pushModels(); // new agent → new model list (+ reset model if incompatible)
}

function newChatId(): string {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function activeChat(): ChatSession {
  let s = sessions.find((x) => x.id === activeSessionId);
  if (!s) {
    s = { id: newChatId(), name: 'New session', transcript: [], createdAt: Date.now() };
    sessions.push(s);
    activeSessionId = s.id;
  }
  return s;
}
/** Reflect the (newly) active session's run state in the chat spinner/border.
 *  Each session owns its own transcript + agentSessionId now, so there's no
 *  global mirror to repoint — only the visible run indicator to re-sync. */
function bindActive(): void {
  chatProvider?.setRunning(activeChat().running ?? false);
}
function persistSessions(): void {
  // Keep the store bounded: newest 20 sessions (never dropping the active or a
  // running one), releasing the engine host of any session we drop so its
  // browser doesn't linger. Cap each transcript so a long run can't bloat state.
  if (sessions.length > 20) {
    const keep = sessions.slice(-20);
    for (const s of sessions) {
      if (keep.includes(s) || s.id === activeSessionId || s.running) continue;
      releaseSession(s.id);
    }
    sessions = sessions.filter((s) => keep.includes(s) || s.id === activeSessionId || s.running);
  }
  const persisted = sessions.map((s) => ({
    id: s.id, name: s.name, agentSessionId: s.agentSessionId, createdAt: s.createdAt, lastRunAt: s.lastRunAt,
    transcript: s.transcript.slice(-400),
  }));
  void extContext?.workspaceState.update('hover.chatSessions', persisted);
  void extContext?.workspaceState.update('hover.activeChat', activeSessionId);
}
/** Push the session list (+ per-session running badges) to the chat top-bar
 *  switcher AND the Conversations sidebar (newest-run first there). */
function pushSessionList(): void {
  chatProvider?.setSessions(sessions.map((s) => ({ id: s.id, name: s.name, running: !!s.running })), activeSessionId);
  const rows = sessions
    .map((s) => ({ id: s.id, name: s.name, lastRunAt: s.lastRunAt, running: !!s.running }))
    .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0));
  conversationsProvider?.setConversations(rows, activeSessionId);
}
function loadSessions(): void {
  const stored = extContext?.workspaceState.get<ChatSession[]>('hover.chatSessions');
  sessions = Array.isArray(stored) && stored.length
    ? stored.map((s) => ({ id: s.id, name: s.name, transcript: Array.isArray(s.transcript) ? s.transcript : [], agentSessionId: s.agentSessionId, createdAt: s.createdAt ?? 0, lastRunAt: s.lastRunAt }))
    : [];
  activeSessionId = extContext?.workspaceState.get<string>('hover.activeChat') ?? sessions[sessions.length - 1]?.id ?? '';
  bindActive();
}

async function newSession(): Promise<void> {
  // Parallel model: a run in another session keeps going on its own host — no
  // need to block starting/switching conversations.
  const s: ChatSession = { id: newChatId(), name: 'New session', transcript: [], createdAt: Date.now() };
  sessions.push(s);
  activeSessionId = s.id;
  persistSessions();
  await chatProvider?.reveal();
  chatProvider?.newSession();
  bindActive(); // fresh session → spinner off
  pushSessionList();
}

/** Switch the active conversation: re-render its transcript + re-sync the run
 *  indicator. A run in the session we're leaving keeps streaming into its own
 *  transcript (parallel model) — we'll see it again when we switch back. */
function switchSession(id: string): void {
  if (!sessions.some((s) => s.id === id) || id === activeSessionId) return;
  activeSessionId = id;
  persistSessions();
  chatProvider?.loadSession(activeChat().transcript);
  bindActive(); // reflect the now-active session's running state
  // If this conversation has a prompt waiting (its run asked while it was in the
  // background), re-dock it now that it's visible.
  const pend = pendingAsks.get(id);
  if (pend) chatProvider?.askUser(pend);
  pushSessionList();
}

/** Apply an inline rename (the sidebar edits the name in place and posts it). */
function renameSession(id: string, name: string): void {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed || trimmed === s.name) return;
  s.name = trimmed;
  persistSessions();
  pushSessionList();
}

/** Delete a conversation (after confirm): cancel + tear down its host, drop it,
 *  and fall back to another conversation (or a fresh one) if it was active. */
async function deleteSession(id: string): Promise<void> {
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  const pick = await vscode.window.showWarningMessage(
    `Delete conversation "${s.name}"? This can't be undone.`,
    { modal: true },
    'Delete',
  );
  if (pick !== 'Delete') return;
  if (s.running) { pool?.cancel(portForSession(id)); }
  releaseSession(id); // kill its engine host + browser
  // Precise cleanup: every run this conversation produced lives under
  // .hover/conversations/<id>/ (meta.json + report.md + screenshots). Remove it.
  // (Crystallized specs in __vibe_tests__/ + their sidecars are intentional
  // outputs and are NOT touched.) Best-effort — the seg sanitization mirrors
  // core's safeSeg() so we hit the same folder the engine wrote.
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (wsRoot) {
    const seg = (id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)) || 'unknown';
    const convDir = vscode.Uri.joinPath(wsRoot, '.hover', 'conversations', seg);
    await vscode.workspace.fs.delete(convDir, { recursive: true, useTrash: false }).then(undefined, () => { /* none yet — fine */ });
  }
  sessions = sessions.filter((x) => x.id !== id);
  if (activeSessionId === id) {
    activeSessionId = sessions[sessions.length - 1]?.id ?? '';
    const next = activeChat(); // seeds a fresh one if none remain
    bindActive();
    chatProvider?.loadSession(next.transcript);
  }
  persistSessions();
  pushSessionList();
}

/** First user prompt names the session (truncated), like Claude Code. */
function nameSessionFromPrompt(prompt: string): void {
  const s = activeChat();
  if (s.name && s.name !== 'New session') return;
  const name = prompt.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (name) { s.name = name; persistSessions(); pushSessionList(); }
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
  await openOptimizeDiff(specUri, { silentIfMissing: false });
}

/** Open `vscode.diff` between a spec and its on-disk optimization candidate.
 *  Used by both the manual "Review Optimization Candidate" command and the
 *  auto-open after an Optimize run finishes. */
async function openOptimizeDiff(specUri: vscode.Uri, opts: { silentIfMissing: boolean }): Promise<void> {
  const candidate = candidateUri(specUri);
  if (!candidate) {
    if (!opts.silentIfMissing) void vscode.window.showWarningMessage('Hover: the spec is not inside an open workspace folder.');
    return;
  }
  const fileName = path.basename(specUri.fsPath);
  if (!(await uriExists(candidate))) {
    if (!opts.silentIfMissing) {
      void vscode.window.showInformationMessage(
        `Hover: no optimization candidate for ${fileName} yet — run "Optimize" (✨) on this spec first.`,
      );
    }
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

/** Run the whole crystallized suite (▶ in the Specs view title). */
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

/** Spec slug from a `<slug>.spec.ts` / `<slug>.api-test.spec.ts` URI. */
function specSlug(uri: vscode.Uri): string {
  return path.basename(uri.fsPath).replace(/\.security\.spec\.ts$/, '').replace(/\.spec\.ts$/, '');
}

function resolveSpecUri(arg?: vscode.TreeItem | vscode.Uri): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  return arg?.resourceUri ?? vscode.window.activeTextEditor?.document.uri;
}

/** 🏥 Self-heal: a saved spec failed on replay (app changed). Read its source,
 *  ask the engine to build a heal prompt (from the spec + the latest run's
 *  failing locator), then the engine bounces `heal-ready` → a normal grounded
 *  run streams the repair into chat and crystallizes a fixed candidate. */
async function healSpec(arg?: vscode.TreeItem | vscode.Uri): Promise<void> {
  const uri = resolveSpecUri(arg);
  if (!uri) return;
  if (!pool || connectedServices === 0) {
    void vscode.window.showWarningMessage('Hover: engine not connected.');
    return;
  }
  const slug = specSlug(uri);
  let specSource: string;
  try {
    specSource = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    void vscode.window.showWarningMessage(`Hover: could not read "${slug}".`);
    return;
  }
  await chatProvider?.reveal();
  if (!pool.healSpec(slug, specSource)) {
    void vscode.window.showWarningMessage('Hover: could not reach the engine.');
  }
}

async function optimizeSpec(arg?: vscode.TreeItem | vscode.Uri): Promise<void> {
  const uri = resolveSpecUri(arg);
  if (!uri) return;
  if (!pool || connectedServices === 0) {
    void vscode.window.showWarningMessage('Hover: engine not connected.');
    return;
  }
  const slug = specSlug(uri);
  // Optimize is cheap text-refinement — let the user pin a small model for it
  // (empty → the engine falls back to the agent's cheap default, e.g. haiku).
  const optimizeModel = vscode.workspace.getConfiguration('hover').get<string>('optimizeModel')?.trim() || undefined;
  if (pool.optimizeSpec(slug, optimizeModel)) {
    pendingOptimizeUri = uri;
    await chatProvider?.reveal();
    chatProvider?.pushBusy(`Optimizing "${slug}" — an LLM is adding assertions (no browser). The diff opens automatically when it's ready.`);
    // Watchdog: codegen runs without step events, so if the engine never
    // replies (crash / lost socket) the spinner would spin forever.
    if (optimizeTimer) clearTimeout(optimizeTimer);
    optimizeTimer = setTimeout(() => {
      optimizeTimer = undefined;
      pendingOptimizeUri = undefined;
      chatProvider?.clearBusy();
      chatProvider?.pushSystem(`Optimize for "${slug}" is taking unusually long — it may have failed. Check the engine, or try again.`);
    }, 150_000);
  }
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
