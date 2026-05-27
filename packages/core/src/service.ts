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
 *     { type: 'skill-saved',     payload: { name, path } }
 *     { type: 'skill-exists',    payload: { slug, existingPath } }
 *     { type: 'skills-list',     payload: { skills: SkillSummary[] } }
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
 *     { type: 'save-skill',    payload: { name, description, steps, overwrite? } }
 *     { type: 'save-spec',     payload: { name, description, steps, assertions?, overwrite? } }
 *     { type: 'save-case-csv', payload: { name, description, steps, assertions?, jiraProjectKey?, labels?, overwrite? } }
 *     { type: 'list-skills' }
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
import { invokeAgent } from './agents/invoke.js';
import {
  listAgentAvailability,
  pickPrimaryAgent,
  type AgentAvailability,
} from './agents/detect.js';
import { getAgent } from './agents/registry.js';
import type { InvokeEvent } from './agents/types.js';
import { getPreflight, invalidatePreflight } from './playwright/preflightCache.js';
import { resolveMcpConfig } from './playwright/resolveMcpConfig.js';
import { listSkills } from './skills/writeSkill.js';
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
  SKILL_CONFIG,
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
  mcpConfig?: string;
  /** CDP URL to preflight before each command (default http://localhost:9222). */
  cdpUrl?: string;
  /** Working directory for the spawned agent. Also where skills are saved
   *  ('<devRoot>/.claude/skills/<slug>/SKILL.md'). Defaults to process.cwd().
   *  In Vite plugin context, set to `server.config.root` so Claude
   *  auto-discovers skills the user previously saved from this project. */
  devRoot?: string;
  /** Plugins contributed by the bundler-plugin wrapper. Each manifest can
   *  add a widget mode, MCP servers, Chrome flags, and lifecycle hooks.
   *  Empty array (default) means "no plugins, behaviour identical to
   *  pre-plugin Hover" — important for the long tail of users who never
   *  install one. */
  plugins?: HoverPluginManifest[];
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
    // In an active mode, the Playwright MCP must point at THAT mode's
    // Chrome (e.g. security mode's 9333), not the default 9222.
    // effectiveLaunchExtras().cdpPort is the source of truth.
    const extras = effectiveLaunchExtras();
    const effectiveCdpUrl = extras?.cdpPort
      ? `http://localhost:${extras.cdpPort}`
      : cdpUrl;
    return resolveMcpConfig({
      cdpUrl: effectiveCdpUrl,
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
  /** Chrome-proxy settings the active mode's activate hook set on us.
   *  Read by `effectiveLaunchExtras()` and threaded into the cdp handlers
   *  (check-cdp / launch-chrome / focus-debug) so the secured Chrome on
   *  9333 actually gets `--proxy-server` + SPKI pin when the user clicks
   *  Launch from the widget. */
  let modeChromeProxy: { port: number; spki: string } | null = null;
  /** Runtime env overrides keyed by mcpServer id, set by plugin
   *  activate hooks (via ctx.setMcpServerEnv). Cleared on mode change.
   *  Merged with the manifest-declared env when the agent's spawn-time
   *  MCP config is built. */
  const mcpEnvOverrides = new Map<string, Record<string, string>>();

  /** The cdp-handler extras (port, userDataDir, proxy) for the active
   *  mode's chromeFlags manifest field, or undefined when no mode is
   *  active. The widget's launch-chrome / check-cdp / focus-debug paths
   *  all consume these so a Chrome relaunch obeys the mode's needs. */
  const effectiveLaunchExtras = (): LaunchExtras | undefined => {
    if (!currentModeId) return undefined;
    const plugin = pluginsByModeId.get(currentModeId);
    const flags = plugin?.chromeFlags;
    if (!flags && !modeChromeProxy) return undefined;
    // Belt + suspenders — flags.activeInModes is honoured if set, but
    // since chromeFlags lives on the plugin that contributed this mode,
    // the default of "applies in own mode" matches what we want.
    if (flags?.activeInModes && !flags.activeInModes.includes('*') && !flags.activeInModes.includes(currentModeId)) {
      // Plugin explicitly restricted its chromeFlags to a different mode.
      // Honour that and only carry modeChromeProxy (set by setChromeProxy).
      return modeChromeProxy ? { proxy: modeChromeProxy } : undefined;
    }
    return {
      cdpPort: flags?.cdpPort,
      userDataDir: flags?.userDataDir,
      // modeChromeProxy wins over flags.proxy because it's the runtime
      // value the activate hook computed (after starting mockttp);
      // flags.proxy is only ever set by tests stubbing the manifest.
      proxy: modeChromeProxy ?? flags?.proxy,
    };
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
    modeChromeProxy = null;
    mcpEnvOverrides.clear();
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
            modeChromeProxy = proxy;
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
          // it to the user.
          modeChromeProxy = null;
          mcpEnvOverrides.clear();
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

    let busy = false;
    let inflight: AbortController | null = null;
    let cancelled = false;

    // If the page reloads (e.g. AI navigated to a same-origin URL), the WS
    // connection drops. Abort the in-flight agent so we don't leave an
    // orphan claude process driving the now-vanished browser tab.
    ws.on('close', () => {
      inflight?.abort();
    });

    const cancel = () => {
      if (!busy) return;
      cancelled = true;
      inflight?.abort();
      // Send a synthetic session_end so the widget resets to idle immediately.
      // The for-await loop below short-circuits on `cancelled`, so no events
      // from the dying child will arrive after this.
      //
      // `cancelled: true` is the load-bearing field — it lets the widget
      // distinguish "user pressed Stop" from "agent crashed". `isError`
      // stays false because the agent didn't fail: the user chose to
      // end the run. The widget renders this as a neutral "Stopped"
      // state rather than a red Failed card.
      send(ws, {
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
        if (busy) {
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
        if (busy) {
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
      if (msg.type === 'save-skill') {
        await handleSaveArtifact(ws, msg, devRoot, SKILL_CONFIG);
        return;
      }
      if (msg.type === 'list-skills') {
        const skills = await listSkills(devRoot);
        send(ws, { type: 'skills-list', payload: { skills } });
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
      if (busy) {
        send(ws, {
          type: 'error',
          payload: { message: 'A command is already running on this connection.' },
        });
        return;
      }

      busy = true;
      cancelled = false;
      inflight = new AbortController();
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

        // Snapshot the agent id so a switch-agent message during the run
        // can't smear two agents across one invocation. (We also gate
        // switch-agent on `busy`, but defense in depth.)
        const invokedAgentId = currentAgentId;
        const invokedDescriptor = getAgent(invokedAgentId);
        // Only Claude's `--allowedTools`/`--disallowedTools` flags are
        // honoured — passing them to a soft-sandbox agent like codex is a
        // no-op (its buildArgs ignores them). We still gate at the service
        // layer for clarity: a hard-sandbox agent gets the tight allowlist,
        // a soft one gets nothing and relies on its descriptor's built-in
        // sandbox flags + developer_instructions.
        const isHardSandbox = invokedDescriptor?.sandboxStrength === 'hard';
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
        for await (const ev of invokeAgent({
          agentId: invokedAgentId,
          prompt: text,
          sessionId: resumeSessionId,
          mcpConfig,
          // cwd = devRoot so Claude Code auto-discovers `.claude/skills/`
          // saved from this project (and CLAUDE.md, if any).
          cwd: devRoot,
          appendSystemPrompt,
          // Skill stays in the allow list so saved skills under
          // <devRoot>/.claude/skills/ can be invoked. mcp__playwright covers
          // every browser tool. Plugin-contributed MCPs are appended when
          // the corresponding mode is active.
          allowedTools: isHardSandbox
            ? ['mcp__playwright', 'Skill', ...activePluginMcpIds]
            : undefined,
          disallowedTools: isHardSandbox
            ? (invokedDescriptor?.defaultDisallowedTools
                ? [...invokedDescriptor.defaultDisallowedTools]
                : undefined)
            : undefined,
          maxBudgetUsd,
          model,
          signal: inflight.signal,
        })) {
          if (cancelled || ws.readyState !== WebSocket.OPEN) return;
          send(ws, { type: 'event', payload: ev });
        }
      } catch (err) {
        // A user-initiated cancel() already sent a synthetic session_end
        // {cancelled:true}. The subsequent AbortError surfacing here would
        // otherwise produce a second session_end{isError:true}, leaving the
        // widget to reconcile two terminal events for one run. CDP isn't
        // suspect either — the user just stopped — so skip preflight
        // invalidation too.
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          const errorEvent: InvokeEvent = {
            kind: 'session_end',
            isError: true,
            summary: message,
          };
          sendIfOpen(ws, { type: 'event', payload: errorEvent });
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
        busy = false;
        inflight = null;
      }
    });
  });

  return {
    port,
    async close() {
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
