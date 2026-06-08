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
 *     { type: 'seeds-list',      payload: { seeds: { name, note, signature, code, source }[] } }
 *     { type: 'spec-saved',      payload: { name, path } }
 *     { type: 'spec-exists',     payload: { slug, existingPath } }
 *     { type: 'case-csv-saved',  payload: { name, path } }
 *     { type: 'case-csv-exists', payload: { slug, existingPath } }
 *     { type: 'error',           payload: { message } }
 *
 *   client → server
 *     { type: 'command',       payload: { text, sessionId?, reRecord?: { slug } } }
 *                                                  // when reRecord.slug is set, the
 *                                                  // service collects tool_use events
 *                                                  // into a step list and on a clean
 *                                                  // session_end overwrites
 *                                                  // __vibe_tests__/<slug>.spec.ts
 *     { type: 'cancel' }
 *     { type: 'check-cdp',     payload: { pageUrl } }                 // "is this widget in the debug Chrome?"
 *     { type: 'launch-chrome', payload: { pageUrl } }                 // start debug Chrome, navigate to pageUrl
 *     { type: 'focus-debug',   payload: { pageUrl } }                 // bringToFront the matching tab in debug Chrome
 *     { type: 'save-spec',     payload: { name, description, steps, assertions?, overwrite? } }
 *     { type: 'save-case-csv', payload: { name, description, steps, assertions?, jiraProjectKey?, labels?, overwrite? } }
 *     { type: 'list-specs' }                                            // ask for every spec under __vibe_tests__/, with parsed JSDoc headers
 *     { type: 'list-seeds' }                                            // ask for built-in + .hover/rules/ translation seeds (read-only)
 *     { type: 'list-agents' }                                          // ask for the full agent registry + install status
 *     { type: 'switch-agent',  payload: { agentId } }                  // set the service's current agent; broadcasts to all connections
 *
 *   server → client (in addition to those documented in the file body):
 *     { type: 'agents',        payload: { current: string, available: AgentAvailability[] } }
 *     { type: 'modes',         payload: { current: string|null, available: ModeEntry[] } }
 *     { type: '<plugin-namespaced>', payload: <plugin-specific> }
 *
 *   client → server (plugin-aware additions):
 *     { type: 'set-mode',      payload: { modeId: string|null } }   // null = exit moded operation
 *     { type: 'list-modes' }
 */
import { WebSocketServer, WebSocket } from 'ws';
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
import { resolveMcpConfig } from './playwright/resolveMcpConfig.js';
import { launchDebugChrome } from './playwright/launchChrome.js';
import { listSpecs } from './specs/listSpecs.js';
import { readSeeds, BUILTIN_SEEDS } from './specs/seeds.js';
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

export interface ServiceOptions {
  port: number;
  agentId?: string;
  model?: string;
  maxBudgetUsd?: number;
  /** How the optimization pass (F7) surfaces in the widget. Default 'suggest'.
   *  'off' = no nudge, 'suggest' = ✦ hint, 'on' = auto-run after Save-as-spec. */
  optimizeMode?: 'off' | 'suggest' | 'on';
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
  const model = opts.model ?? 'sonnet';
  // No default budget cap — long real-world flows (form filling, multi-step
  // checkouts) routinely run past the old $0.50 ceiling and got cut off
  // mid-run. The widget shows the running $ counter in the header instead,
  // so the user can hit Stop when they've seen enough. Pass maxBudgetUsd
  // explicitly (or via the Vite plugin option) if a hard ceiling is needed.
  const maxBudgetUsd = opts.maxBudgetUsd;
  const optimizeMode = opts.optimizeMode ?? 'suggest';
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
  const buildMcpConfig = (): string => {
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
      payload: { agentId: currentAgentId, model, version: PROTOCOL_VERSION, optimizeMode },
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
        // Widget asks for every spec under <devRoot>/__vibe_tests__/ so it
        // can render the Specs tab in the Saved-sessions overlay. Each
        // summary carries `originalPrompt` (parsed from the JSDoc header)
        // so the Re-record button can resubmit it as a normal command.
        const specs = await listSpecs(devRoot);
        send(ws, { type: 'specs-list', payload: { specs } });
        return;
      }
      if (msg.type === 'list-seeds') {
        // Widget's Seeds tab: show which translation seeds Hover sees — the
        // built-in set + whatever the user dropped in <devRoot>/.hover/rules/.
        // Read-only; users add seeds by hand (no download path).
        const builtinNames = new Set(BUILTIN_SEEDS.map(s => s.name));
        const seeds = (await readSeeds(devRoot)).map(s => ({
          name: s.name,
          note: s.note ?? '',
          signature: s.signature,
          code: s.example?.code ?? '',
          source: builtinNames.has(s.name) ? 'builtin' : 'project',
        }));
        send(ws, { type: 'seeds-list', payload: { seeds } });
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
      // Re-record mode: when the client (widget Specs tab or hover CLI)
      // passes `reRecord: { slug }`, runSession collects the tool_use events
      // into a SpecStep[] and, on a clean finish, we overwrite the existing
      // __vibe_tests__/<slug>.spec.ts. Same flow the widget uses for "Save as
      // Spec", but the spec already exists and is being regenerated for the
      // current UI.
      const reRecordSlug =
        msg.payload && typeof msg.payload === 'object' && 'reRecord' in msg.payload
          ? ((msg.payload as { reRecord?: { slug?: unknown } }).reRecord?.slug as string | undefined)
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
      try {
        // Build the MCP config first — it's pure local file IO and lets
        // us assert plugin-contributed servers landed in the config even
        // when CDP preflight subsequently fails (useful for smoke tests
        // that don't have a real debug Chrome wired up).
        const mcpConfig = buildMcpConfig();

        // Preflight: refuse to invoke if CDP isn't reachable. Otherwise the
        // Playwright MCP server would silently launch its own Chromium —
        // and Hover's premise is to drive the user's existing Chrome (with
        // their dev state, cookies, devtools open), never spawn a fresh one.
        // In an active mode, the relevant CDP endpoint may be the mode's
        // own port (e.g. 9333 for security), not the default cdpUrl.
        const preflightExtras = effectiveLaunchExtras();
        const preflightCdpUrl = preflightExtras?.cdpPort
          ? `http://localhost:${preflightExtras.cdpPort}`
          : cdpUrl;
        const cdp = await getPreflight(preflightCdpUrl);
        if (!cdp.ok) {
          send(ws, {
            type: 'event',
            payload: {
              kind: 'session_end',
              isError: true,
              summary: cdp.reason,
            } satisfies InvokeEvent,
          });
          return;
        }

        // Build a system-prompt addendum telling the agent about the user's
        // current tab. The most common waste we observed: agent calls
        // browser_navigate to the same URL the user is already on, triggering
        // a wasteful full-page reload that also destroys the Hover widget
        // momentarily (the widget re-injects + recovers, but the agent's
        // own session sometimes gets confused).
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
        const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const activePluginMcpIds: string[] = [];
        if (currentModeId) {
          for (const p of plugins) {
            for (const srv of p.mcpServers ?? []) {
              const scope = srv.activeInModes ?? (p.mode ? [p.mode.id] : []);
              if (scope.includes('*') || scope.includes(currentModeId)) {
                activePluginMcpIds.push(`mcp__${sanitize(srv.id)}`);
              }
            }
          }
        }
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
            maxBudgetUsd,
            model,
            apiKey: currentApiKey,
            signal: run.abort.signal,
          },
          (ev) => {
            // Stream to whichever ws is attached NOW — survives the widget
            // reconnecting mid-run (emitToRun is a no-op during a reconnect gap).
            if (run.cancelled) return;
            emitToRun({ type: 'event', payload: ev });
          },
        );

        // Re-record: write a fresh spec from the steps runSession accumulated
        // (`user` → `step`* → `done`). Only on a clean, non-cancelled finish —
        // a cancelled/aborted run throws out of runSession into the catch
        // below, and an errored agent leaves the original spec untouched.
        if (reRecordSlug && !run.cancelled) {
          if (runResult.isError) {
            emitToRun({
              type: 'error',
              payload: {
                message:
                  `Re-record failed: ${runResult.summary || 'agent reported an error'}. ` +
                  `Original spec left unchanged.`,
              },
            });
          } else {
            try {
              const { writeSpec } = await import('./specs/writeSpec.js');
              const written = await writeSpec({
                devRoot,
                name: reRecordSlug,
                steps: runResult.steps,
                overwrite: true,
              });
              emitToRun({
                type: 'spec-saved',
                payload: { name: reRecordSlug, path: written.path },
              });
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              emitToRun({
                type: 'error',
                payload: { message: `Re-record could not write spec: ${m}` },
              });
            }
          }
        }
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
          // Force the next command to re-probe CDP. The error could be from
          // Chrome dying, MCP spawning a stray Chromium, the user closing
          // their debug window — anything that would make a cached "all
          // healthy" result lie. Invalidate the mode-effective URL (see
          // preflightCdpUrl above) — not the static cdpUrl — so security
          // mode invalidations don't no-op against the default port.
          const invalExtras = effectiveLaunchExtras();
          const invalCdpUrl = invalExtras?.cdpPort
            ? `http://localhost:${invalExtras.cdpPort}`
            : cdpUrl;
          invalidatePreflight(invalCdpUrl);
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
