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
import { send, type ClientMessage } from './service/types.js';
import { buildCdpHint, buildCdpHintResume } from './service/cdpHint.js';
import {
  handleCheckCdp,
  handleLaunchChrome,
  handleFocusDebug,
} from './service/cdpHandlers.js';
import {
  handleSaveArtifact,
  SKILL_CONFIG,
  SPEC_CONFIG,
  CASE_CSV_CONFIG,
} from './service/saveHandlers.js';

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

  // Resolve a CDP-pinned MCP config pointing at our local
  // `@playwright/mcp` install. See resolveMcpConfig.ts for the rationale
  // (avoids `npx -y @playwright/mcp@latest`'s registry round-trip on
  // every command — 300 ms - 2 s of hot-path latency).
  const mcpConfig = opts.mcpConfig ?? resolveMcpConfig({ cdpUrl, port });

  // Surface post-listen errors instead of crashing the host process.
  wss.on('error', err => {
    process.stderr.write(`[hover] WebSocketServer error: ${err.message}\n`);
  });

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
    // dropdown immediately on connect / reconnect (e.g. after HMR).
    void getAvailability(false).then(available => {
      send(ws, { type: 'agents', payload: { current: currentAgentId, available } });
    });

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
      send(ws, {
        type: 'event',
        payload: {
          kind: 'session_end',
          isError: true,
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
        await handleCheckCdp(ws, msg, cdpUrl);
        return;
      }
      if (msg.type === 'launch-chrome') {
        await handleLaunchChrome(ws, msg, cdpUrl);
        return;
      }
      if (msg.type === 'focus-debug') {
        await handleFocusDebug(ws, msg, cdpUrl);
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
        const appendSystemPrompt = resumeSessionId
          ? buildCdpHintResume(cdp.tabs)
          : buildCdpHint(cdp.tabs);

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
          // every browser tool.
          allowedTools: isHardSandbox ? ['mcp__playwright', 'Skill'] : undefined,
          disallowedTools: isHardSandbox
            ? [
                // file / shell / data access — never appropriate for browser driving
                'Bash', 'BashOutput', 'KillBash',
                'Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit',
                'Grep', 'Glob', 'Task', 'TodoWrite',
                'WebFetch', 'WebSearch',
                // plan / worktree / cron / notification — irrelevant in -p mode
                'EnterPlanMode', 'ExitPlanMode',
                'EnterWorktree', 'ExitWorktree',
                'CronCreate', 'CronDelete', 'CronList',
                'PushNotification', 'RemoteTrigger',
                // task & tool introspection added in claude 2.1.x — let through and
                // the agent will burn turns exploring instead of executing
                'ToolSearch',
                'Monitor', 'TaskOutput', 'TaskStop',
                'AskUserQuestion',
                'ShareOnboardingGuide',
              ]
            : undefined,
          maxBudgetUsd,
          model,
          signal: inflight.signal,
        })) {
          if (cancelled || ws.readyState !== WebSocket.OPEN) return;
          send(ws, { type: 'event', payload: ev });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorEvent: InvokeEvent = {
          kind: 'session_end',
          isError: true,
          summary: message,
        };
        if (ws.readyState === WebSocket.OPEN) {
          send(ws, { type: 'event', payload: errorEvent });
        }
        // Force the next command to re-probe CDP. The error could be from
        // Chrome dying, MCP spawning a stray Chromium, the user closing
        // their debug window — anything that would make a cached "all
        // healthy" result lie.
        invalidatePreflight(cdpUrl);
      } finally {
        busy = false;
        inflight = null;
      }
    });
  });

  return {
    port,
    close: () =>
      new Promise<void>((res, rej) => {
        wss.close(err => (err ? rej(err) : res()));
      }),
  };
}
