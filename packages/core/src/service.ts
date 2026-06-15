/**
 * Local Hover WebSocket service.
 *
 * One process per Vite dev server. Started by vite-plugin-hover's
 * configureServer hook, torn down on closeBundle. Binds to 127.0.0.1 only.
 *
 * Wire protocol (newline-free JSON over WebSocket):
 *
 *   server → client
 *     { type: 'hello',           payload: { agentId, model, version } }
 *     { type: 'event',           payload: InvokeEvent }              // see agents/types.ts
 *     { type: 'cdp-status',      payload: { state, reason?, matchingTabUrl?, browser?, launching? } }
 *     { type: 'specs-list',      payload: { specs: SpecSummary[] } }
 *     { type: 'spec-saved',      payload: { name, path } }
 *     { type: 'spec-exists',     payload: { slug, existingPath } }
 *     { type: 'case-csv-saved',  payload: { name, path } }
 *     { type: 'case-csv-exists', payload: { slug, existingPath } }
 *     { type: 'error',           payload: { message } }
 *
 *   client → server
 *     { type: 'command',       payload: { text, sessionId? } }
 *     { type: 'cancel' }
 *     { type: 'check-cdp',     payload: { pageUrl } }                 // "is this widget in the debug Chrome?"
 *     { type: 'launch-chrome', payload: { pageUrl } }                 // start debug Chrome, navigate to pageUrl
 *     { type: 'focus-debug',   payload: { pageUrl } }                 // bringToFront the matching tab in debug Chrome
 *     { type: 'save-spec',     payload: { name, description, steps, assertions?, overwrite? } }
 *     { type: 'save-case-csv', payload: { name, description, steps, assertions?, jiraProjectKey?, labels?, overwrite? } }
 *     { type: 'list-specs' }                                            // ask for every spec under __vibe_tests__/, with parsed JSDoc headers
 *     { type: 'list-agents' }                                          // ask for the full agent registry + install status
 *     { type: 'switch-agent',  payload: { agentId } }                  // set the service's current agent; broadcasts to all connections
 *     { type: 'reveal-source', payload: { source } }                   // relay a data-hover-source value to other clients (F2 page→editor)
 *
 *   server → client (in addition to those documented in the file body):
 *     { type: 'reveal-source', payload: { source } }                   // relayed to non-origin clients (the VSCode ext jumps the editor)
 *     { type: 'agents',        payload: { current: string, available: AgentAvailability[] } }
 *     { type: 'modes',         payload: { current: string|null, available: ModeEntry[] } }
 *     { type: '<plugin-namespaced>', payload: <plugin-specific> }
 *
 *   client → server (plugin-aware additions):
 *     { type: 'set-mode',      payload: { modeId: string|null } }   // null = exit moded operation
 *     { type: 'list-modes' }
 */
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runSession } from './runSession.js';
import { readConventions } from './service/conventions.js';
import { optimizeSpecWithAgent } from './specs/optimizeSpecWithAgent.js';
import { promoteOptimized, discardOptimized } from './specs/optimizeSpec.js';
import {
  listAgentAvailability,
  pickPrimaryAgent,
  type AgentAvailability,
} from './agents/detect.js';
import { getAgent } from './agents/registry.js';
import type { InvokeEvent } from './agents/types.js';
import { getPreflight, invalidatePreflight } from './playwright/preflightCache.js';
import { resolveMcpConfig, mcpToolPrefix } from './playwright/resolveMcpConfig.js';
import { launchDebugChrome } from './playwright/launchChrome.js';
import { listSpecs } from './specs/listSpecs.js';
import { writeSessionRecord, parseFindings, tallyTools } from './sessions/sessions.js';
import { send, sendIfOpen, type ClientMessage } from './service/types.js';
import { buildCdpHint, buildCdpHintResume } from './service/cdpHint.js';
import {
  handleCheckCdp,
  handleLaunchChrome,
  handleFocusDebug,
  type LaunchExtras,
} from './service/cdpHandlers.js';
import {
  handleSaveArtifact,
  SPEC_CONFIG,
  CASE_CSV_CONFIG,
} from './service/saveHandlers.js';
import {
  CURRENT_API_VERSION,
  type HoverPluginManifest,
  type ModeActivateCtx,
} from './plugin-api.js';

/** The source-reader MCP server (codeContext). Id → the `mcp__hover_source`
 *  tool prefix; script path resolved relative to this module so it works from
 *  dist/. Spawned only when codeContext is enabled. */
const SOURCE_MCP_ID = 'hover-source';
const SOURCE_MCP_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp', 'sourceServer.js');
/** The control-actuation MCP server (always on) — force-toggles sr-only hidden
 *  radios/checkboxes the locked-down Playwright `browser_click` can't actuate. */
const CONTROL_MCP_ID = 'hover-control';
const CONTROL_MCP_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp', 'actuateServer.js');

export interface ServiceOptions {
  port: number;
  agentId?: string;
  model?: string;
  maxBudgetUsd?: number;
  mcpConfig?: string;
  /** CDP URL to preflight before each command (default http://localhost:9222). */
  cdpUrl?: string;
  /** Working directory for the spawned agent. Also the root under which saved
   *  specs (`__vibe_tests__/`), sidecars + seeds (`.hover/`) live. Defaults to
   *  process.cwd(); in Vite plugin context, set to `server.config.root` so the
   *  agent runs against the project (and Claude Code reads its CLAUDE.md). */
  devRoot?: string;
  /** Plugins contributed by the bundler-plugin wrapper. Each manifest can
   *  add a widget mode, MCP servers, Chrome flags, and lifecycle hooks.
   *  Empty array (default) means "no plugins, behaviour identical to
   *  pre-plugin Hover" — important for the long tail of users who never
   *  install one. */
  plugins?: HoverPluginManifest[];
  /** When true, the service launches the single debug Chrome itself at
   *  startup — AFTER firing plugin `hover:service:start` hooks, so a plugin
   *  that set a resident proxy (e.g. security's MITM) has its flags baked
   *  into that one Chrome. Previously each bundler shim called
   *  launchDebugChrome() directly, which bypassed the service and so couldn't
   *  see the proxy; moving it here is what enables the single-Chrome model.
   *  Default false (shims pass it through from their own option). */
  autoLaunchChrome?: boolean;
  /** Opt-in: give the agent READ-ONLY, fenced access to the project's source
   *  via a `read_source` / `list_source` MCP server (in addition to Playwright
   *  MCP), in every mode. Lets it author against real selectors/routes and do
   *  white-box security/pentest. Fenced to devRoot, secrets/keys/.git/build
   *  excluded, no write/exec. Default false — the agent stays browser-only. */
  codeContext?: boolean;
  /** The dev-server URL the auto-launched Chrome should open. Each shim knows
   *  its own framework's dev URL and passes it here. Defaults to the cdp host
   *  if unset, but shims should always provide it. */
  devUrl?: string;
}

export interface ServiceHandle {
  /** The port the WebSocketServer actually bound to. May differ from
   *  the requested port if it was taken (we auto-bump up to 10 times). */
  port: number;
  close(): Promise<void>;
}

// ClientMessage + send moved to ./service/types.ts so the cdp + save
// handler modules can share them. See those files for the wire shape.


const PROTOCOL_VERSION = 1;
const PORT_RETRIES = 10;

/** CJK-presence test — mirrors voice.js's detectLanguage. Any Han character
 *  in the prompt flips the agent's prose output to Chinese. */
const CJK_RE = /[一-鿿]/;

/** Appended to the agent's system prompt when the user's prompt contains CJK,
 *  so the human-facing prose (verification summary / ## Findings / step
 *  narration) comes back in Chinese — matching how Voice mode picks a Chinese
 *  TTS voice for the same prompt. Deliberately scoped to PROSE only: the agent
 *  must still use the page's real (often English) accessible names, labels,
 *  and selectors when driving the browser. */
const ZH_OUTPUT_DIRECTIVE =
  '用户使用中文下达指令。请用简体中文撰写所有面向用户的文字输出：验证结论摘要、' +
  '`## Findings` 区块（bug / 问题 / 备注）、以及每一步的中文描述。' +
  '注意：这只影响你写给用户看的文字。操作浏览器时仍要使用页面真实的（通常是英文的）' +
  '角色名、标签、可访问名称和选择器——不要把它们翻译成中文。';

/**
 * Normal-mode grounded actuation. The Playwright MCP interaction tools take a
 * free-form `element` description that doesn't round-trip to a replayable
 * selector (it gets crystallized as a confabulated getByText). So in normal
 * mode we DENY them and route every interaction through the Hover control MCP,
 * whose role+name/testId/text args come straight from the snapshot and
 * crystallize 1:1. (Security / pentest keep the Playwright tools — they explore
 * to capture traffic, not to crystallize browser steps.)
 */
const GROUNDED_ACTUATION_DENY = [
  'mcp__playwright__browser_click',
  'mcp__playwright__browser_type',
  'mcp__playwright__browser_fill_form',
  'mcp__playwright__browser_select_option',
];
const GROUNDED_ACTUATION_DIRECTIVE =
  'INTERACTING WITH THE PAGE: browser_click / browser_type / browser_fill_form / ' +
  'browser_select_option are disabled. To act on the page, use the Hover control ' +
  'tools — mcp__hover-control__click_control / fill_control / select_control / ' +
  'check_control — passing the element\'s accessible role + name exactly as they ' +
  'appear in the latest browser_snapshot (fall back to its testId, then its real ' +
  'visible text, only when there is no clean role+name). Always browser_snapshot ' +
  'first to read the real role + name. This keeps the saved spec\'s selectors ' +
  'grounded in what the page actually exposes. browser_navigate / browser_snapshot ' +
  '/ browser_wait_for / browser_tabs / browser_press_key remain available.';

/**
 * Try to bind a WebSocketServer to <host>:<port>. Resolves with the wss on
 * success; rejects with the bind error (typically EADDRINUSE) on failure.
 */
function bind(host: string, port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host, port });
    const onError = (err: Error) => {
      wss.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      wss.off('error', onError);
      resolve(wss);
    };
    wss.once('error', onError);
    wss.once('listening', onListening);
  });
}

/**
 * Find a free port in [start, start+attempts) and bind a WebSocketServer to
 * it. Each example app that loads vite-plugin-hover runs its own service —
 * with auto-bump, multiple Vite dev servers can coexist (basic-app on 51789,
 * stock-registration on 51790, etc.) and each widget connects only to its
 * own service. The widget reads the actual port from window.__HOVER_PORT__.
 */
async function pickAndBind(host: string, start: number, attempts: number): Promise<WebSocketServer> {
  let lastErr: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await bind(host, start + i);
    } catch (err) {
      lastErr = err as Error;
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`[hover] no free port in [${start}, ${start + attempts}): ${lastErr?.message ?? ''}`);
}

export async function startService(opts: ServiceOptions): Promise<ServiceHandle> {
  const requestedPort = opts.port;
  // Resolve the primary agent. Honor an explicit opts.agentId (or HOVER_AGENT
  // env var) when set AND installed; otherwise fall back to whichever
  // registered agent the user actually has on PATH, in registry order. This
  // is what lets a user with only codex installed open a Hover dev server
  // without needing to set HOVER_AGENT=codex.
  const preferred = opts.agentId ?? process.env.HOVER_AGENT;
  const primary = await pickPrimaryAgent(preferred);
  let currentAgentId: string =
    primary?.descriptor.id ?? preferred ?? 'claude';
  // Optional model API key the widget supplied (set-api-key). Held in memory
  // for this service's lifetime only — never written to disk, never logged.
  // Injected into the spawned CLI's env so a user without a logged-in
  // subscription can drive Hover on their own key.
  let currentApiKey: string | undefined =
    process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? undefined;
  if (!primary) {
    // Nothing installed — still bind so the widget can show a helpful
    // "install one of these" dialog. Commands will fail with
    // AgentNotInstalledError at invoke time.
    process.stderr.write(
      `[hover] no supported agent CLI found on PATH (looked for: ` +
      `${(await listAgentAvailability()).map(a => a.id).join(', ')}). ` +
      `The widget will open but commands will fail until you install one.\n`,
    );
  } else if (preferred && preferred !== primary.descriptor.id) {
    process.stderr.write(
      `[hover] requested agent "${preferred}" is not installed; falling back to "${primary.descriptor.id}".\n`,
    );
  }
  let model = opts.model ?? 'sonnet';
  // No default budget cap — long real-world flows (form filling, multi-step
  // checkouts) routinely run past the old $0.50 ceiling and got cut off
  // mid-run. The widget shows the running $ counter in the header instead,
  // so the user can hit Stop when they've seen enough. Pass maxBudgetUsd
  // explicitly (or via the Vite plugin option) if a hard ceiling is needed.
  const maxBudgetUsd = opts.maxBudgetUsd;
  const cdpUrl = opts.cdpUrl ?? 'http://localhost:9222';
  const devRoot = opts.devRoot ?? process.cwd();

  const wss = await pickAndBind('127.0.0.1', requestedPort, PORT_RETRIES);
  const port = (wss.address() as { port: number }).port;

  // Build a fresh MCP config per command, so the currently-active mode's
  // contributed servers (plus runtime env from setMcpServerEnv) land in
  // the file the agent reads. `opts.mcpConfig` still wins if the host
  // forced an explicit one, but in that case mode-contributed servers
  // are silently dropped — we log a warning the first time it happens.
  let warnedExplicitMcpOverride = false;
  const buildMcpConfig = (sessionTag?: string, sourceGate: 'always' | 'ask' | 'deny' = 'ask'): string => {
    if (opts.mcpConfig) {
      const activePlugin = currentModeId ? pluginsByModeId.get(currentModeId) : null;
      if (activePlugin?.mcpServers?.length && !warnedExplicitMcpOverride) {
        process.stderr.write(
          `[hover] explicit opts.mcpConfig overrides plugin-contributed MCP servers ` +
            `(plugin "${activePlugin.name}" wanted ${activePlugin.mcpServers
              .map((s) => s.id)
              .join(', ')}).\n`,
        );
        warnedExplicitMcpOverride = true;
      }
      return opts.mcpConfig;
    }
    const extra: { id: string; command: string; args?: string[]; env?: Record<string, string> }[] = [];
    if (currentModeId) {
      for (const p of plugins) {
        for (const srv of p.mcpServers ?? []) {
          const scope = srv.activeInModes ?? (p.mode ? [p.mode.id] : []);
          const inMode = scope.includes('*') || scope.includes(currentModeId);
          if (!inMode) continue;
          extra.push({
            id: srv.id,
            command: srv.command,
            args: srv.args,
            env: {
              ...(srv.env ?? {}),
              ...(mcpEnvOverrides.get(srv.id) ?? {}),
            },
          });
        }
      }
    }
    // codeContext (opt-in, all modes): the fenced read-only source reader.
    // 'deny' drops it entirely; 'ask' makes it gate each read through the editor
    // (HOVER_APPROVAL_PORT); 'always' lets it read without asking.
    if (opts.codeContext && sourceGate !== 'deny') {
      extra.push({
        id: SOURCE_MCP_ID,
        command: process.execPath,
        args: [SOURCE_MCP_SCRIPT],
        env: {
          HOVER_PROJECT_ROOT: devRoot,
          HOVER_SOURCE_GATE: sourceGate === 'ask' ? 'ask' : 'allow',
          ...(sourceGate === 'ask' ? { HOVER_APPROVAL_PORT: String(port) } : {}),
        },
      });
    }
    // Control actuation (always on, all modes): force-toggles sr-only hidden
    // radios/checkboxes the locked-down Playwright click can't actuate. Drives
    // the same debug Chrome over CDP; crystallizes to a normal .check() step.
    extra.push({
      id: CONTROL_MCP_ID,
      command: process.execPath,
      args: [CONTROL_MCP_SCRIPT],
      env: { HOVER_CDP_URL: cdpUrl, HOVER_DEV_URL: opts.devUrl ?? cdpUrl },
    });
    // Single-Chrome model: the Playwright MCP always points at the one debug
    // Chrome on the normal cdpUrl. (Pre-single-Chrome this branched to a
    // mode-specific port like 9333; there's no second Chrome anymore.)
    return resolveMcpConfig({
      cdpUrl,
      port,
      extra,
      // Suffix the filename by the mode so different mode toggles within
      // one service produce distinct config files (debugging aid).
      suffix: currentModeId ?? undefined,
      // Screenshots / traces land under the project's .hover home, grouped
      // per run, instead of the MCP server's default OS temp dir.
      outputDir: sessionTag
        ? resolve(devRoot, '.hover', 'screenshots', sessionTag.replace(/[^a-zA-Z0-9._-]+/g, '-'))
        : undefined,
    });
  };

  // Surface post-listen errors instead of crashing the host process.
  wss.on('error', err => {
    process.stderr.write(`[hover] WebSocketServer error: ${err.message}\n`);
  });

  // ──────────────────────────────────────────────────────────────────
  // Plugin registry
  // ──────────────────────────────────────────────────────────────────
  // Validate + index plugins once at startup. Reasons we fail loud here
  // (rather than at first use): mode-id collisions are a configuration
  // bug, not a runtime one — the widget mode-picker would silently miss
  // entries, which is worse than a startup error the user has to fix.
  const plugins = opts.plugins ?? [];
  const pluginsByName = new Map<string, HoverPluginManifest>();
  const pluginsByModeId = new Map<string, HoverPluginManifest>();
  for (const p of plugins) {
    if (p.apiVersion !== CURRENT_API_VERSION) {
      throw new Error(
        `[hover] plugin "${p.name}" targets apiVersion ${String(
          p.apiVersion,
        )} but this Hover supports ${CURRENT_API_VERSION}.`,
      );
    }
    if (pluginsByName.has(p.name)) {
      throw new Error(`[hover] duplicate plugin name: ${p.name}`);
    }
    pluginsByName.set(p.name, p);
    if (p.mode) {
      if (pluginsByModeId.has(p.mode.id)) {
        throw new Error(
          `[hover] two plugins contribute the same mode id "${p.mode.id}": ` +
            `${pluginsByModeId.get(p.mode.id)?.name} and ${p.name}`,
        );
      }
      pluginsByModeId.set(p.mode.id, p);
    }
  }

  /** id of the currently-active mode, or null for normal (unmoded) mode. */
  let currentModeId: string | null = null;

  /**
   * The single in-flight agent run, held at SERVICE scope (not per-connection)
   * so it SURVIVES the widget's WS dropping. The widget lives in the page the
   * agent drives, so any agent navigation (a pentest payload in the URL, an
   * HMR reload) tears the widget down and closes its socket — but the agent is
   * still happily driving the tab over CDP and recording findings server-side.
   * Killing it on every navigation made pentest mode (which navigates
   * constantly) unusable. Instead: detach on close, keep streaming to whichever
   * ws is attached, and only abort if no widget reconnects within the grace
   * window. Single active run — Hover binds 127.0.0.1 for one local user.
   */
  const RECONNECT_GRACE_MS = 15_000;
  interface ActiveRun {
    abort: AbortController;
    cancelled: boolean;
    /** ws currently receiving this run's events; null during a reconnect gap. */
    client: WebSocket | null;
    graceTimer: ReturnType<typeof setTimeout> | null;
    /** the prompt, echoed to a reconnecting widget so it can restore context. */
    prompt: string;
  }
  let activeRun: ActiveRun | null = null;
  /** In-flight source-read approval requests: correlation id → the source-MCP
   *  socket that asked, so the editor's response can be routed back to it. */
  const pendingApprovals = new Map<string, WebSocket>();
  /** Send a run event to whichever ws is currently attached (survives reconnect). */
  const emitToRun = (msg: { type: string; payload?: unknown }): void => {
    const c = activeRun?.client;
    if (c && c.readyState === WebSocket.OPEN) send(c, msg);
  };
  /** Chrome-proxy settings a plugin's `hover:service:start` hook set on us
   *  (security's resident MITM). RESIDENT for the whole session — set once
   *  before Chrome launches, never cleared on mode change — so the single
   *  debug Chrome is born with `--proxy-server` + the SPKI pin and entering
   *  Security mode is just a runtime flip of the proxy, not a Chrome relaunch.
   *  Read by `effectiveLaunchExtras()` and threaded into every cdp handler
   *  (check-cdp / launch-chrome / focus-debug) plus the initial auto-launch. */
  let residentChromeProxy: { port: number; spki: string } | null = null;
  /** Runtime env overrides keyed by mcpServer id, set by plugin
   *  activate hooks (via ctx.setMcpServerEnv). Cleared on mode change.
   *  Merged with the manifest-declared env when the agent's spawn-time
   *  MCP config is built. */
  const mcpEnvOverrides = new Map<string, Record<string, string>>();

  /** The cdp-handler extras (proxy) threaded into launch-chrome / check-cdp /
   *  focus-debug and the initial auto-launch. In the single-Chrome model this
   *  is driven purely by the RESIDENT proxy (set in `hover:service:start`),
   *  NOT by the active mode — there is one Chrome on the normal CDP port that
   *  is always proxied; entering Security mode flips the proxy's behaviour,
   *  it does not relaunch Chrome on a different port. Returns undefined when
   *  no plugin set a resident proxy (the common no-security case), so plain
   *  Hover is byte-for-byte unchanged. */
  const effectiveLaunchExtras = (): LaunchExtras | undefined => {
    if (!residentChromeProxy) return undefined;
    return { proxy: residentChromeProxy };
  };

  /** Send the current mode catalogue to one ws (or all if undefined). */
  const broadcastModes = (target?: WebSocket): void => {
    const available = plugins
      .filter((p): p is HoverPluginManifest & { mode: NonNullable<HoverPluginManifest['mode']> } =>
        Boolean(p.mode),
      )
      .map((p) => ({
        id: p.mode.id,
        label: p.mode.label,
        description: p.mode.description,
        // Widget retints to this while the mode is engaged (falls back to
        // security orange in the widget when absent).
        accent: p.mode.accent,
        pluginName: p.name,
      }));
    const payload = { current: currentModeId, available };
    const targets = target ? [target] : [...wss.clients];
    for (const client of targets) {
      if (client.readyState === WebSocket.OPEN) {
        send(client, { type: 'modes', payload });
      }
    }
  };

  /** Broadcast helper passed to plugin hooks. Plugin-side events should
   *  be namespaced ("security:flow:added") to avoid collisions with
   *  core's protocol vocabulary. */
  const broadcastPluginEvent = (event: { type: string; payload?: unknown }): void => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        send(client, event);
      }
    }
  };

  const switchMode = async (newModeId: string | null): Promise<void> => {
    if (newModeId === currentModeId) return;

    // Tear down old mode
    if (currentModeId) {
      const old = pluginsByModeId.get(currentModeId);
      if (old?.hooks?.['hover:mode:deactivate']) {
        try {
          await old.hooks['hover:mode:deactivate']({
            devRoot,
            broadcast: broadcastPluginEvent,
            modeId: currentModeId,
          });
        } catch (err) {
          process.stderr.write(
            `[hover] plugin "${old.name}" deactivate failed: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
          );
        }
      }
    }
    // NOTE: neither residentChromeProxy NOR mcpEnvOverrides is cleared here.
    // In the single-Chrome model both are RESIDENT — set once in
    // service:start (e.g. security's HOVER_SECURITY_API base + token), they
    // must survive every mode toggle so the agent's spawned MCP server can
    // always reach the control plane. Clearing them on mode change was the
    // pre-resident behaviour and would leave the security MCP server with no
    // env → it exits with "failed". Mode changes now only flip plugin runtime
    // state via the plugin's own activate/deactivate hooks.
    currentModeId = null;

    // Bring up new mode
    if (newModeId) {
      const next = pluginsByModeId.get(newModeId);
      if (!next) {
        throw new Error(`[hover] unknown modeId "${newModeId}"`);
      }
      currentModeId = newModeId;
      if (next.hooks?.['hover:mode:activate']) {
        const ctx: ModeActivateCtx = {
          devRoot,
          broadcast: broadcastPluginEvent,
          modeId: newModeId,
          setChromeProxy(proxy) {
            // Retained for API compatibility. In the single-Chrome model the
            // proxy is normally set once in service:start; if an activate hook
            // still calls this, treat it as updating the resident proxy.
            residentChromeProxy = proxy;
          },
          setMcpServerEnv(id, env) {
            mcpEnvOverrides.set(id, env);
          },
        };
        try {
          await next.hooks['hover:mode:activate'](ctx);
        } catch (err) {
          // Activate failed half-way — roll back state so we don't
          // pretend to be in `newModeId` with no sidecars running.
          // Widget still trusts the broadcast below to learn we're back
          // to default. The error is rethrown so the caller can surface
          // it to the user. residentChromeProxy and mcpEnvOverrides are NOT
          // touched — both are owned by service:start, independent of mode
          // activation (clearing the env would break the resident security
          // MCP server).
          currentModeId = null;
          broadcastModes();
          throw err;
        }
      }
    }

    broadcastModes();
  };

  // Cache the agent-availability list. The PATH scan is cheap (one `which`
  // per registered agent) but we still don't want to re-run it on every
  // hello; a single Vite dev server typically sees the widget connect and
  // reconnect dozens of times during HMR.
  let agentAvailabilityCache: AgentAvailability[] | null = null;
  const getAvailability = async (refresh: boolean): Promise<AgentAvailability[]> => {
    if (refresh || agentAvailabilityCache === null) {
      agentAvailabilityCache = await listAgentAvailability();
    }
    return agentAvailabilityCache;
  };

  // The CDP preflight cache (shared between this service's command path
  // and the widget's `check-cdp` ping via `cdpStatus.checkCdpStatus`)
  // lives in ./playwright/preflightCache.ts. 30-second TTL, keyed by
  // cdpUrl. See that file for the rationale.

  const broadcastAgents = async (): Promise<void> => {
    const available = await getAvailability(false);
    const payload = { current: currentAgentId, available };
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        send(client, { type: 'agents', payload });
      }
    }
  };

  wss.on('connection', ws => {
    send(ws, {
      type: 'hello',
      payload: { agentId: currentAgentId, model, version: PROTOCOL_VERSION },
    });
    // Send the agent list as a follow-up event so the widget can render the
    // dropdown immediately on connect / reconnect (e.g. after HMR). The
    // socket may have closed between scheduling and firing, so guard the
    // send and catch any availability-probe rejection — otherwise it
    // surfaces as an unhandled rejection in strict-mode Node.
    void getAvailability(false)
      .then(available => {
        sendIfOpen(ws, {
          type: 'agents',
          payload: { current: currentAgentId, available },
        });
      })
      .catch(err => {
        console.warn('[hover] agents broadcast failed:', err);
      });
    // Send the mode catalogue too, so the widget can render the mode
    // toggle immediately. Empty list when no plugins are loaded.
    broadcastModes(ws);

    // Re-attach to a run that's still in flight (the previous widget dropped —
    // most commonly the agent navigated and reloaded the page the widget lives
    // in). Cancel the pending abort, point the run's event stream at this fresh
    // socket, and tell the widget so it can restore its "running" UI. Without
    // this the run would be killed on every agent navigation.
    // Only re-attach during a genuine reconnect GAP (the prior client is gone).
    // If a live client is still attached, this is a SECOND widget (e.g. the
    // user's regular tab alongside the debug-Chrome tab — both inject a widget
    // on the same origin and open their own socket). Seizing the stream would
    // silence the first widget and let the second's close abort a healthy run,
    // so leave a second concurrent widget in idle UI rather than hijacking.
    if (activeRun && activeRun.client === null) {
      if (activeRun.graceTimer) {
        clearTimeout(activeRun.graceTimer);
        activeRun.graceTimer = null;
      }
      activeRun.client = ws;
      send(ws, { type: 'run-active', payload: { prompt: activeRun.prompt } });
    }

    // If the widget's socket closes while a run it owns is in flight, DON'T
    // abort — the agent is still driving the tab over CDP. Detach this ws and
    // start a grace window; a reconnecting widget (above) cancels the abort.
    // Only if nobody comes back do we abort, so we still never leave an orphan.
    ws.on('close', () => {
      if (activeRun && activeRun.client === ws) {
        activeRun.client = null;
        activeRun.graceTimer = setTimeout(() => {
          activeRun?.abort.abort();
        }, RECONNECT_GRACE_MS);
      }
    });

    const cancel = () => {
      if (!activeRun) return;
      activeRun.cancelled = true;
      activeRun.abort.abort();
      // Send a synthetic session_end so the widget resets to idle immediately.
      // The for-await loop below short-circuits on `cancelled`, so no events
      // from the dying child will arrive after this.
      //
      // `cancelled: true` is the load-bearing field — it lets the widget
      // distinguish "user pressed Stop" from "agent crashed". `isError`
      // stays false because the agent didn't fail: the user chose to
      // end the run. The widget renders this as a neutral "Stopped"
      // state rather than a red Failed card.
      emitToRun({
        type: 'event',
        payload: {
          kind: 'session_end',
          isError: false,
          cancelled: true,
          summary: 'cancelled by user',
        } satisfies InvokeEvent,
      });
    };

    ws.on('message', async data => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === 'cancel') {
        cancel();
        return;
      }
      if (msg.type === 'reveal-source') {
        // F2 page→editor transport: an in-page client (widget) captured a
        // `data-hover-source` value off a clicked element. Relay it to every
        // OTHER connected client — the VSCode extension listens and opens the
        // file at <rel-path>:<line>:<col>. The originating page needs no echo.
        const source = msg.payload?.source;
        if (typeof source !== 'string' || !source) return;
        for (const client of wss.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            send(client, { type: 'reveal-source', payload: { source } });
          }
        }
        return;
      }
      // Source-read approval gate (codeContext in 'ask' mode). The source MCP
      // asks before each read; we relay to the editor (the active run's client)
      // and route its decision back. No editor attached → default allow (the
      // reader is fenced + read-only; the gate is consent UX, not a security
      // boundary — never hang the run on it).
      if (msg.type === 'source-approval-request') {
        const id = msg.payload?.approvalId;
        if (typeof id !== 'string') return;
        const editor = activeRun?.client;
        if (editor && editor.readyState === WebSocket.OPEN) {
          pendingApprovals.set(id, ws);
          send(editor, {
            type: 'source-approval-request',
            payload: { approvalId: id, sourcePath: msg.payload?.sourcePath, sourceKind: msg.payload?.sourceKind },
          });
        } else {
          sendIfOpen(ws, { type: 'source-approval-response', payload: { approvalId: id, allow: true } });
        }
        return;
      }
      if (msg.type === 'source-approval-response') {
        const id = msg.payload?.approvalId;
        if (typeof id !== 'string') return;
        const asker = pendingApprovals.get(id);
        pendingApprovals.delete(id);
        if (asker) sendIfOpen(asker, { type: 'source-approval-response', payload: { approvalId: id, allow: msg.payload?.allow === true } });
        return;
      }
      if (msg.type === 'list-modes') {
        broadcastModes(ws);
        return;
      }
      if (msg.type === 'set-mode') {
        if (activeRun) {
          send(ws, {
            type: 'error',
            payload: { message: 'set-mode: a command is already running; stop it first' },
          });
          return;
        }
        const wanted = msg.payload?.modeId ?? null;
        if (wanted !== null && typeof wanted !== 'string') {
          send(ws, {
            type: 'error',
            payload: { message: 'set-mode: modeId must be a string or null' },
          });
          return;
        }
        if (wanted !== null && !pluginsByModeId.has(wanted)) {
          send(ws, {
            type: 'error',
            payload: { message: `set-mode: unknown modeId "${wanted}"` },
          });
          return;
        }
        try {
          await switchMode(wanted);
        } catch (err) {
          send(ws, {
            type: 'error',
            payload: {
              message: `set-mode failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          });
        }
        return;
      }
      if (msg.type === 'list-agents') {
        // Force a refresh — the user may have just installed a new CLI
        // and clicked the dropdown to see the change.
        const available = await getAvailability(true);
        send(ws, { type: 'agents', payload: { current: currentAgentId, available } });
        return;
      }
      if (msg.type === 'switch-agent') {
        const wanted = msg.payload?.agentId;
        if (typeof wanted !== 'string' || !wanted) {
          send(ws, { type: 'error', payload: { message: 'switch-agent: agentId is required' } });
          return;
        }
        if (!getAgent(wanted)) {
          send(ws, { type: 'error', payload: { message: `switch-agent: unknown agent "${wanted}"` } });
          return;
        }
        // Refuse to switch mid-flight; the user's running command would
        // otherwise outlive its own descriptor and the events it produces
        // would be parsed against the wrong wire format.
        if (activeRun) {
          send(ws, {
            type: 'error',
            payload: { message: 'switch-agent: a command is already running; stop it first' },
          });
          return;
        }
        const available = await getAvailability(false);
        const entry = available.find(a => a.id === wanted);
        if (!entry?.installed) {
          send(ws, {
            type: 'error',
            payload: {
              message: `switch-agent: "${wanted}" is not installed. ${entry?.installHint ? `Install: ${entry.installHint}` : ''}`.trim(),
            },
          });
          return;
        }
        currentAgentId = wanted;
        await broadcastAgents();
        return;
      }
      if (msg.type === 'set-model') {
        // Persist the model for subsequent runs (sonnet / opus / haiku / …).
        // Refuse mid-run so an in-flight invocation keeps the model it started
        // with. Applies from the next command.
        const wanted = msg.payload?.model;
        if (typeof wanted !== 'string' || !wanted) {
          send(ws, { type: 'error', payload: { message: 'set-model: model is required' } });
          return;
        }
        if (activeRun) {
          send(ws, { type: 'error', payload: { message: 'set-model: a command is already running; stop it first' } });
          return;
        }
        model = wanted;
        send(ws, { type: 'hello', payload: { agentId: currentAgentId, model, version: PROTOCOL_VERSION } });
        return;
      }
      if (msg.type === 'set-api-key') {
        // The widget supplies (or clears) a model API key. Stored in memory
        // only and injected into the spawned CLI's env at invoke time — never
        // persisted, never logged, never echoed back. Empty/missing clears it.
        const key = msg.payload?.key;
        currentApiKey = typeof key === 'string' && key.trim() ? key.trim() : undefined;
        const envVar = getAgent(currentAgentId)?.apiKeyEnv;
        send(ws, { type: 'api-key-status', payload: { hasKey: !!currentApiKey, envVar } });
        return;
      }
      if (msg.type === 'list-specs') {
        // The extension asks for every spec under <devRoot>/__vibe_tests__/ to
        // render the Specs view. Each summary carries `originalPrompt` (parsed
        // from the JSDoc header) as provenance — what the spec verifies.
        const specs = await listSpecs(devRoot);
        send(ws, { type: 'specs-list', payload: { specs } });
        return;
      }
      if (msg.type === 'save-spec') {
        await handleSaveArtifact(ws, msg, devRoot, SPEC_CONFIG);
        return;
      }
      if (msg.type === 'save-case-csv') {
        await handleSaveArtifact(ws, msg, devRoot, CASE_CSV_CONFIG);
        return;
      }
      // Stage 7 (F7) widget flow: optimize a saved spec, then promote/discard
      // the candidate after the human reviews the diff. optimizeSpecWithAgent
      // spawns the codegen LLM (no browser, no MCP); the original spec is never
      // touched until an explicit promote.
      if (msg.type === 'optimize-spec') {
        const slug = msg.payload?.slug;
        if (typeof slug !== 'string' || !slug) {
          send(ws, { type: 'error', payload: { message: 'optimize-spec: slug is required' } });
          return;
        }
        try {
          const res = await optimizeSpecWithAgent(devRoot, slug, {
            agentId: currentAgentId, model, maxBudgetUsd, apiKey: currentApiKey,
          });
          send(ws, { type: 'optimize-result', payload: { slug, original: res.original, candidate: res.code } });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'optimize-failed', payload: { slug, reason } });
        }
        return;
      }
      if (msg.type === 'promote-optimized') {
        const slug = msg.payload?.slug;
        if (typeof slug !== 'string' || !slug) {
          send(ws, { type: 'error', payload: { message: 'promote-optimized: slug is required' } });
          return;
        }
        try {
          const path = await promoteOptimized(devRoot, slug);
          send(ws, { type: 'optimized-promoted', payload: { slug, path } });
          send(ws, { type: 'specs-list', payload: { specs: await listSpecs(devRoot) } });
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', payload: { message: `promote-optimized: ${m}` } });
        }
        return;
      }
      if (msg.type === 'discard-optimized') {
        const slug = msg.payload?.slug;
        if (typeof slug !== 'string' || !slug) {
          send(ws, { type: 'error', payload: { message: 'discard-optimized: slug is required' } });
          return;
        }
        await discardOptimized(devRoot, slug);
        send(ws, { type: 'optimized-discarded', payload: { slug } });
        return;
      }
      // v0.12 — plugin-contributed save handlers. Lookup is O(plugins),
      // which is fine because there's at most a handful of plugins ever
      // loaded. Each plugin's manifest declares `saveHandlers[].type`
      // as the WS message type the widget sends; we match exactly.
      if (typeof msg.type === 'string' && msg.type.startsWith('save:')) {
        for (const p of plugins) {
          const handler = p.saveHandlers?.find((h) => h.type === msg.type);
          if (!handler) continue;
          try {
            const result = await handler.handle({ devRoot, payload: msg.payload });
            send(ws, {
              type: `${msg.type}:saved`,
              payload: { name: result.slug, path: result.path },
            });
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            send(ws, {
              type: 'error',
              payload: { message: `${msg.type}: ${m}` },
            });
          }
          return;
        }
        // No plugin matched — surface as a normal error rather than
        // silently swallowing.
        send(ws, {
          type: 'error',
          payload: { message: `no plugin registered for save type "${msg.type}"` },
        });
        return;
      }
      if (msg.type === 'check-cdp') {
        await handleCheckCdp(ws, msg, cdpUrl, effectiveLaunchExtras());
        return;
      }
      if (msg.type === 'launch-chrome') {
        await handleLaunchChrome(ws, msg, cdpUrl, effectiveLaunchExtras());
        return;
      }
      if (msg.type === 'focus-debug') {
        await handleFocusDebug(ws, msg, cdpUrl, effectiveLaunchExtras());
        return;
      }
      if (msg.type !== 'command') return;
      const text = msg.payload?.text;
      const resumeSessionId =
        typeof msg.payload?.sessionId === 'string' && msg.payload.sessionId.length > 0
          ? msg.payload.sessionId
          : undefined;
      if (typeof text !== 'string' || !text.trim()) return;
      if (activeRun) {
        send(ws, {
          type: 'error',
          payload: { message: 'A command is already running.' },
        });
        return;
      }

      const run: ActiveRun = {
        abort: new AbortController(),
        cancelled: false,
        client: ws,
        graceTimer: null,
        prompt: text,
      };
      activeRun = run;
      // Session-ledger state — declared outside the try so the catch path can
      // still record an aborted / thrown run (the spend view wants those too).
      const sessionStartedAt = new Date().toISOString();
      let sessionEnd: { turns?: number; costUsd?: number; tokens?: number } = {};
      let sessionRecorded = false;
      // Reproducibility context captured up front (snapshot the mode now so a
      // mid-run switch can't smear it; the rest are filled as the run learns
      // them). Account labels are LABELS ONLY — never the credentials.
      const runMode = currentModeId;
      const runResumeOf = resumeSessionId;
      const screenshotTag = (resumeSessionId ?? sessionStartedAt).replace(/[^a-zA-Z0-9._-]+/g, '-');
      const runEnv = ((): { id?: string; name?: string } | undefined => {
        const e = (msg.payload as { env?: { id?: string; name?: string } } | undefined)?.env;
        return e && typeof e === 'object' ? { id: e.id, name: e.name } : undefined;
      })();
      let runTargetUrl: string | undefined;
      let runAccountLabels: string[] | undefined;
      const recordSession = async (
        outcome: 'completed' | 'error' | 'aborted',
        stepCount: number,
        detail?: { summary?: string; errorReason?: string; steps?: { kind: string; tool?: string }[] },
      ) => {
        if (sessionRecorded) return;
        sessionRecorded = true;
        const endedAt = new Date().toISOString();
        const parsed = detail?.summary ? parseFindings(detail.summary) : { summary: '', findings: [] };
        const toolCounts = detail?.steps ? tallyTools(detail.steps) : undefined;
        const target =
          runTargetUrl || runEnv ? { url: runTargetUrl, id: runEnv?.id, name: runEnv?.name } : undefined;
        await writeSessionRecord(devRoot, {
          startedAt: sessionStartedAt,
          endedAt,
          durationMs: Date.parse(endedAt) - Date.parse(sessionStartedAt),
          agent: currentAgentId,
          model,
          mode: runMode,
          prompt: text,
          outcome,
          errorReason: detail?.errorReason,
          summary: parsed.summary || undefined,
          findings: parsed.findings.length ? parsed.findings : undefined,
          toolCounts: toolCounts && Object.keys(toolCounts).length ? toolCounts : undefined,
          target: target ? { url: target.url, envId: target.id, envName: target.name } : undefined,
          accountLabels: runAccountLabels,
          screenshotTag,
          resumeOf: runResumeOf,
          turns: sessionEnd.turns,
          costUsd: sessionEnd.costUsd,
          tokensUsed: sessionEnd.tokens,
          stepCount,
        });
      };
      try {
        // Build the MCP config first — it's pure local file IO and lets
        // us assert plugin-contributed servers landed in the config even
        // when CDP preflight subsequently fails (useful for smoke tests
        // that don't have a real debug Chrome wired up).
        // Group this run's screenshots under .hover/screenshots/<tag>. A
        // resumed session reuses its id so follow-up turns share one dir;
        // a first turn keys on its start timestamp (the agent's own
        // sessionId isn't known until session_start, after the MCP launches).
        const sourceGate = msg.payload?.sourceAccess ?? 'ask';
        const mcpConfig = buildMcpConfig(screenshotTag, sourceGate);

        // Preflight: refuse to invoke if CDP isn't reachable. Otherwise the
        // Playwright MCP server would silently launch its own Chromium —
        // and Hover's premise is to drive the user's existing Chrome (with
        // their dev state, cookies, devtools open), never spawn a fresh one.
        const cdp = await getPreflight(cdpUrl);
        if (!cdp.ok) {
          send(ws, {
            type: 'event',
            payload: {
              kind: 'session_end',
              isError: true,
              summary: cdp.reason,
            } satisfies InvokeEvent,
          });
          // A preflight failure is the most common "why did my run die" — make
          // it a diagnostic ledger row rather than silently returning.
          await recordSession('error', 0, { errorReason: cdp.reason });
          return;
        }

        // Target URL for the ledger: the localhost tab (the dev server) if we
        // have one, else the first tab.
        runTargetUrl =
          cdp.tabs?.find((t) => /localhost|127\.0\.0\.1/.test(t.url))?.url ?? cdp.tabs?.[0]?.url;

        // Build a system-prompt addendum telling the agent about the user's
        // current tab. The most common waste we observed: agent calls
        // browser_navigate to the same URL the user is already on, triggering
        // a wasteful full-page reload that discards the app state the run had
        // built up (login session, form input, position in a flow) — so the
        // agent has to redo work and sometimes loses track of where it was.
        // First turn pays the full rules + narration block; follow-up
        // turns (`resumeSessionId` set) get only the volatile tab list.
        // The static rules are already in the prior turn's context, and
        // re-sending them fragments Anthropic's prompt-cache fingerprint
        // (cache hits require byte-identical system prompts across turns).
        // See cdpHint.ts for the why.
        let appendSystemPrompt = resumeSessionId
          ? buildCdpHintResume(cdp.tabs)
          : buildCdpHint(cdp.tabs);
        // Knowledge layer (F5): on the first turn, fold in the project's
        // .hover/conventions.md (static, like cdpHint's rules — skipped on
        // resume to keep the prompt cache intact). The service reads the file;
        // the agent never gains filesystem access (D2).
        if (!resumeSessionId) {
          const conventions = await readConventions(devRoot);
          if (conventions) appendSystemPrompt = `${appendSystemPrompt}\n\n${conventions}`;
        }
        // Add plugin-contributed prompt additions whose scope includes the
        // current mode (or '*' for always-on). Walks ALL loaded plugins,
        // not just the active-mode plugin — a plugin that contributes
        // an always-on prompt without contributing a mode is a valid
        // shape (e.g. a future "always remind the agent of these
        // project conventions" plugin).
        for (const p of plugins) {
          for (const add of p.systemPromptAdditions ?? []) {
            // Default scope: if the plugin has a mode, the prompt is
            // gated to that mode; if it doesn't have a mode, the prompt
            // is always-on (treated as if activeInModes was '*').
            const scope = add.activeInModes ?? (p.mode ? [p.mode.id] : ['*']);
            const inScope =
              scope.includes('*') ||
              (currentModeId !== null && scope.includes(currentModeId));
            if (inScope) {
              appendSystemPrompt = `${appendSystemPrompt}\n\n${add.text}`;
            }
          }
        }

        // codeContext: tell the agent the fenced source reader exists, so it
        // proactively reads the real code (better selectors/routes when
        // authoring; white-box confirmation when probing) instead of only
        // guessing from the rendered DOM.
        if (opts.codeContext) {
          appendSystemPrompt = `${appendSystemPrompt}\n\nYou also have read-only access to this project's source via mcp__hover_source (read_source / list_source), fenced to the repo (secrets, keys, .env, .git, node_modules and build output are refused). Use it to read the actual component / route / API code — write tests against the real selectors and, when probing for security issues, confirm a finding against the server code (the query, the authz check) rather than guessing from the page alone.\n\nIMPORTANT — when you get stuck or confused, READ THE CODE before concluding anything: a control you can't operate (a click that does nothing, a field that won't take input), validation that blocks you with no visible reason, a conditional section that won't appear. Use list_source / read_source to open that component's source and look at the real markup, CSS (e.g. visually-hidden / sr-only inputs), event handlers, and state wiring. Base your diagnosis and your next action on what the code actually does — never assert a framework / state / onChange bug you have not seen in the source. Reading source may require the user's one-click approval; if a read is declined or unavailable, just continue from what you can observe on the page and report honestly — do not retry the read in a loop, and do not fall back to guessing an unseen cause.`;
        }

        // Test accounts the prompt referenced via @label (resolved by the editor
        // from its vault). Injected here, NOT in the user-visible transcript, so
        // the agent can log in; the literal values it types are redacted out of
        // the saved spec (writeSpec redactions). Never echoed to the user.
        const runAccounts = Array.isArray(msg.payload?.accounts) ? msg.payload!.accounts : [];
        if (runAccounts.length) {
          // Ledger keeps LABELS ONLY — never the username/password.
          runAccountLabels = runAccounts.map((a) => a.label);
          const lines = runAccounts.map(a => {
            const role = a.role ? ` (${a.role})` : '';
            const user = a.username ? `username ${JSON.stringify(a.username)}` : 'username not on file';
            const pass = a.password ? `, password ${JSON.stringify(a.password)}` : '';
            return `- @${a.label}${role}: ${user}${pass}`;
          }).join('\n');
          appendSystemPrompt = `${appendSystemPrompt}\n\nTest accounts available for this run — when the task refers to an @label, log in using that account's credentials. Use them ONLY to fill authentication fields; never print or echo them in your replies or summaries.\n${lines}`;
        }

        // Mirror the prompt's language in the agent's *prose* output — the
        // verification summary (Result card), the ## Findings block, and the
        // step narration — the same way Voice mode mirrors it in TTS. A
        // Chinese prompt should produce a Chinese report. This does NOT change
        // how the agent operates the browser: selectors, role names, and the
        // app's own (often English) UI text are unaffected — only the agent's
        // human-facing writing follows the user. Detection mirrors voice.js's
        // detectLanguage (CJK presence → zh).
        if (CJK_RE.test(text)) {
          appendSystemPrompt = `${appendSystemPrompt}\n\n${ZH_OUTPUT_DIRECTIVE}`;
        }

        // Normal mode (no security/pentest plugin active): force grounded
        // actuation — the agent uses mcp__hover-control__* instead of the
        // Playwright interaction tools, so saved selectors are role+name, never
        // a confabulated getByText.
        const groundedActuation = currentModeId === null;
        if (groundedActuation) {
          appendSystemPrompt = `${appendSystemPrompt}\n\n${GROUNDED_ACTUATION_DIRECTIVE}`;
        }

        // Snapshot the agent id so a switch-agent message during the run
        // can't smear two agents across one invocation. (We also gate
        // switch-agent on an active run, but defense in depth.) runSession gates
        // the allow/deny lists on the agent's sandboxStrength internally.
        const invokedAgentId = currentAgentId;
        // Active mode's plugin-contributed MCP server ids — added to the
        // hard-sandbox allow list so Claude can actually call them. Claude
        // sanitises non-alphanumeric chars in the id when forming tool
        // names (e.g. "@hover-dev/security:flows" → "mcp__hover_dev_security_flows"),
        // and `--allowedTools mcp__foo` matches every tool under that
        // prefix. We pass the prefix `mcp__<sanitized>` so all of the
        // server's tools are reachable.
        // Control actuation is always reachable (every mode).
        const activePluginMcpIds: string[] = [mcpToolPrefix(CONTROL_MCP_ID)];
        if (currentModeId) {
          for (const p of plugins) {
            for (const srv of p.mcpServers ?? []) {
              const scope = srv.activeInModes ?? (p.mode ? [p.mode.id] : []);
              if (scope.includes('*') || scope.includes(currentModeId)) {
                activePluginMcpIds.push(mcpToolPrefix(srv.id));
              }
            }
          }
        }
        // codeContext: the fenced source reader is allowed in every mode.
        if (opts.codeContext) activePluginMcpIds.push(mcpToolPrefix(SOURCE_MCP_ID));
        const runResult = await runSession(
          {
            agentId: invokedAgentId,
            prompt: text,
            sessionId: resumeSessionId,
            mcpConfig,
            // cwd = devRoot so the agent runs against the project (and Claude
            // Code reads its CLAUDE.md, if any).
            cwd: devRoot,
            appendSystemPrompt,
            // mcp__playwright covers every browser tool; active-mode plugin MCP
            // servers are appended. (Save-as-Skill retired → no Skill tool.)
            allowedToolsExtra: activePluginMcpIds,
            // Normal mode: deny the Playwright interaction tools so the agent
            // must use the grounded mcp__hover-control__* actuation tools.
            disallowedToolsExtra: groundedActuation ? GROUNDED_ACTUATION_DENY : undefined,
            maxBudgetUsd,
            model,
            apiKey: currentApiKey,
            signal: run.abort.signal,
          },
          (ev) => {
            // Cost/turns/tokens for the session ledger ride the session_end
            // event — snoop them off the stream. Also track the running `usage`
            // totals so an aborted/errored run still records partial spend.
            if (ev.kind === 'session_end') {
              sessionEnd = { turns: ev.turns, costUsd: ev.costUsd, tokens: ev.tokens };
            } else if (ev.kind === 'usage') {
              sessionEnd = {
                turns: ev.turns ?? sessionEnd.turns,
                costUsd: ev.costUsd ?? sessionEnd.costUsd,
                tokens: ev.tokens ?? sessionEnd.tokens,
              };
            }
            // Stream to whichever ws is attached NOW — survives the widget
            // reconnecting mid-run (emitToRun is a no-op during a reconnect gap).
            if (run.cancelled) return;
            emitToRun({ type: 'event', payload: ev });
          },
        );

        // Append to the `.hover/sessions/` ledger (best-effort, never throws).
        // `saved`/`specSlug` are patched in later by markSessionSaved when the
        // user crystallizes — save-spec arrives as a separate WS message.
        await recordSession(
          run.cancelled ? 'aborted' : runResult.isError ? 'error' : 'completed',
          runResult.steps.filter((s) => s.kind === 'step').length,
          {
            summary: runResult.summary,
            errorReason: runResult.isError ? runResult.summary : undefined,
            steps: runResult.steps,
          },
        );
      } catch (err) {
        // A user-initiated cancel() already sent a synthetic session_end
        // {cancelled:true}. The subsequent AbortError surfacing here would
        // otherwise produce a second session_end{isError:true}, leaving the
        // widget to reconcile two terminal events for one run. CDP isn't
        // suspect either — the user just stopped — so skip preflight
        // invalidation too.
        if (!run.cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          const errorEvent: InvokeEvent = {
            kind: 'session_end',
            isError: true,
            summary: message,
          };
          emitToRun({ type: 'event', payload: errorEvent });
          await recordSession('error', 0, { errorReason: message });
          // Force the next command to re-probe CDP. The error could be from
          // Chrome dying, MCP spawning a stray Chromium, the user closing
          // their debug window — anything that would make a cached "all
          // healthy" result lie.
          invalidatePreflight(cdpUrl);
        } else {
          // User-initiated cancel — still worth a ledger row (spend view).
          await recordSession('aborted', 0, { errorReason: 'Cancelled by the user.' });
        }
      } finally {
        if (run.graceTimer) clearTimeout(run.graceTimer);
        activeRun = null;
      }
    });
  });

  // ───────────────────────── service:start + single Chrome ─────────────────
  // Fire plugin `hover:service:start` hooks BEFORE launching Chrome, so a
  // plugin (security) can boot its resident proxy and call setChromeProxy.
  // residentChromeProxy is then baked into the one auto-launched Chrome.
  for (const p of plugins) {
    const hook = p.hooks?.['hover:service:start'];
    if (!hook) continue;
    try {
      await hook({
        devRoot,
        broadcast: broadcastPluginEvent,
        setChromeProxy(proxy) {
          residentChromeProxy = proxy;
        },
        setMcpServerEnv(id, env) {
          mcpEnvOverrides.set(id, env);
        },
      });
    } catch (err) {
      process.stderr.write(
        `[hover] plugin "${p.name}" service:start failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }

  // Auto-launch the single debug Chrome here (moved out of the bundler shims
  // so it happens AFTER service:start and can carry residentChromeProxy).
  // Fire-and-forget — startup must not block on Chrome, and a launch failure
  // is non-fatal (the widget's amber ✨ lets the user retry on demand).
  if (opts.autoLaunchChrome) {
    const launchPort = (() => {
      try {
        return Number(new URL(cdpUrl).port) || 9222;
      } catch {
        return 9222;
      }
    })();
    const launchUrl = opts.devUrl ?? cdpUrl;
    launchDebugChrome({
      url: launchUrl,
      port: launchPort,
      proxy: residentChromeProxy ?? undefined,
    })
      .then((r) => {
        if (!r.ok) {
          process.stderr.write(`[hover] auto-launch Chrome failed: ${r.reason}\n`);
        }
      })
      .catch((err) => {
        process.stderr.write(
          `[hover] auto-launch Chrome error: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      });
  }

  return {
    port,
    async close() {
      // Kill any in-flight run FIRST. The run is held at service scope and is
      // only torn down by aborting its signal (invoke.ts SIGTERMs the agent
      // child on abort). wss.close() below stops the listener but does NOT
      // terminate established client sockets, so no ws.on('close') fires — so
      // without this the agent child would keep driving the debug Chrome as an
      // orphan after the dev server is gone, and a pending grace timer would
      // fire abort() 15s into the void.
      if (activeRun) {
        if (activeRun.graceTimer) clearTimeout(activeRun.graceTimer);
        activeRun.cancelled = true;
        activeRun.abort.abort();
        activeRun = null;
      }
      // Deactivate the active mode first, then run every plugin's
      // shutdown hook (regardless of which mode is active — a plugin may
      // own background state even outside its mode). Best-effort: log
      // and continue on individual failures so one buggy plugin doesn't
      // strand the others' sidecars.
      if (currentModeId) {
        try {
          await switchMode(null);
        } catch (err) {
          process.stderr.write(
            `[hover] error deactivating mode during shutdown: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
          );
        }
      }
      for (const p of plugins) {
        const hook = p.hooks?.['hover:service:shutdown'];
        if (!hook) continue;
        try {
          await hook({ devRoot, broadcast: broadcastPluginEvent });
        } catch (err) {
          process.stderr.write(
            `[hover] plugin "${p.name}" shutdown failed: ${
              err instanceof Error ? err.message : String(err)
            }\n`,
          );
        }
      }
      await new Promise<void>((res, rej) => {
        wss.close(err => (err ? rej(err) : res()));
      });
    },
  };
}
