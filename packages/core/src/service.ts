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
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { invokeAgent } from './agents/invoke.js';
import type { InvokeEvent } from './agents/types.js';
import { checkCdpStatus, focusDebugTab } from './playwright/cdpStatus.js';
import { launchDebugChrome } from './playwright/launchChrome.js';
import { preflightCDP } from './playwright/preflight.js';
import {
  writeSkill,
  listSkills,
  SkillExistsError,
  type SkillStep,
} from './skills/writeSkill.js';
import { writeSpec, SpecExistsError, type SpecAssertion } from './specs/writeSpec.js';
import { writeCaseCsv, CaseCsvExistsError } from './specs/writeCaseCsv.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MCP_CONFIG = resolve(HERE, '..', 'mcp.config.json');

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

interface ClientMessage {
  type: string;
  payload?: {
    text?: string;
    sessionId?: string;
    name?: string;
    description?: string;
    steps?: SkillStep[];
    assertions?: SpecAssertion[];
    overwrite?: boolean;
    /** save-case-csv only — passed through to writeCaseCsv as extra
     *  fields on the test case's Labels column. */
    jiraProjectKey?: string;
    labels?: string;
    /** check-cdp / launch-chrome / focus-debug — the widget's
     *  window.location.href so service can compare origins or navigate the
     *  newly-launched debug Chrome to the same URL. */
    pageUrl?: string;
  };
}

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
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  // No default budget cap — long real-world flows (form filling, multi-step
  // checkouts) routinely run past the old $0.50 ceiling and got cut off
  // mid-run. The widget shows the running $ counter in the header instead,
  // so the user can hit Stop when they've seen enough. Pass maxBudgetUsd
  // explicitly (or via the Vite plugin option) if a hard ceiling is needed.
  const maxBudgetUsd = opts.maxBudgetUsd;
  const mcpConfig = opts.mcpConfig ?? DEFAULT_MCP_CONFIG;
  const cdpUrl = opts.cdpUrl ?? 'http://localhost:9222';
  const devRoot = opts.devRoot ?? process.cwd();

  const wss = await pickAndBind('127.0.0.1', requestedPort, PORT_RETRIES);
  const port = (wss.address() as { port: number }).port;

  // Surface post-listen errors instead of crashing the host process.
  wss.on('error', err => {
    process.stderr.write(`[hover] WebSocketServer error: ${err.message}\n`);
  });

  wss.on('connection', ws => {
    send(ws, { type: 'hello', payload: { agentId, model, version: PROTOCOL_VERSION } });

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
      if (msg.type === 'save-skill') {
        await handleSaveSkill(ws, msg, devRoot);
        return;
      }
      if (msg.type === 'list-skills') {
        const skills = await listSkills(devRoot);
        send(ws, { type: 'skills-list', payload: { skills } });
        return;
      }
      if (msg.type === 'save-spec') {
        await handleSaveSpec(ws, msg, devRoot);
        return;
      }
      if (msg.type === 'save-case-csv') {
        await handleSaveCaseCsv(ws, msg, devRoot);
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
        const cdp = await preflightCDP(cdpUrl);
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
        const appendSystemPrompt = buildCdpHint(cdp.tabs);

        for await (const ev of invokeAgent({
          agentId,
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
          allowedTools: ['mcp__playwright', 'Skill'],
          disallowedTools: [
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
          ],
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

function send(ws: WebSocket, message: { type: string; payload?: unknown }): void {
  ws.send(JSON.stringify(message));
}

function buildCdpHint(tabs: { url: string; title?: string }[]): string {
  if (tabs.length === 0) return '';
  // Prefer the localhost tab if we have multiple — that's almost always the
  // dev server the user is testing against.
  const localhost = tabs.find(t => /localhost|127\.0\.0\.1/.test(t.url));
  const active = localhost ?? tabs[0];
  return [
    `The user's Chrome currently has these tabs open:`,
    ...tabs.map(t => `  - ${t.url}${t.title ? `  (${t.title})` : ''}`),
    ``,
    `The likely active dev tab is: ${active.url}`,
    ``,
    `Important: do NOT call browser_navigate to a URL that is already the active tab.`,
    `That triggers an unnecessary full page reload. Instead, call browser_snapshot`,
    `first to see the current page state, and only navigate if you actually need a`,
    `different URL.`,
  ].join('\n');
}

/**
 * "Is this widget running inside the debug Chrome?" The widget asks this on
 * connect (and after every status-changing event) so it can render itself as
 * either:
 *   - same-window  → normal, drives the page
 *   - wrong-window → disabled, with a "use the other window" notice
 *   - no-cdp       → enabled but click triggers launch-chrome instead
 */
async function handleCheckCdp(
  ws: WebSocket,
  msg: ClientMessage,
  cdpUrl: string,
): Promise<void> {
  const pageUrl = msg.payload?.pageUrl;
  if (typeof pageUrl !== 'string' || !pageUrl) {
    send(ws, { type: 'error', payload: { message: 'check-cdp: pageUrl is required' } });
    return;
  }
  const status = await checkCdpStatus(cdpUrl, pageUrl);
  send(ws, { type: 'cdp-status', payload: status });
}

/**
 * Launch a debug Chrome navigated to `pageUrl`, then re-check status. The
 * re-check usually returns 'wrong-window' (because the widget asking is in
 * the user's regular Chrome, not the freshly-launched one) — the widget then
 * displays the "use the other window" state.
 */
async function handleLaunchChrome(
  ws: WebSocket,
  msg: ClientMessage,
  cdpUrl: string,
): Promise<void> {
  const pageUrl = msg.payload?.pageUrl;
  if (typeof pageUrl !== 'string' || !pageUrl) {
    send(ws, { type: 'error', payload: { message: 'launch-chrome: pageUrl is required' } });
    return;
  }
  // Tell the widget we're launching so it can render a spinner immediately —
  // findChromeBinary + spawn + ready-poll can take a few seconds.
  send(ws, { type: 'cdp-status', payload: { state: 'no-cdp', launching: true } });

  const port = (() => {
    try {
      return Number(new URL(cdpUrl).port) || 9222;
    } catch {
      return 9222;
    }
  })();
  const result = await launchDebugChrome({ url: pageUrl, port });
  if (!result.ok) {
    send(ws, { type: 'cdp-status', payload: { state: 'no-cdp', reason: result.reason } });
    return;
  }
  // Re-check after launch so the widget gets the real status.
  const status = await checkCdpStatus(cdpUrl, pageUrl);
  send(ws, { type: 'cdp-status', payload: status });
}

/**
 * bringToFront the debug-Chrome tab matching `pageUrl`'s origin (or open one
 * if none exists). Used by the wrong-window UI's "switch to debug Chrome"
 * button. Doesn't return cdp-status — bringToFront doesn't change anything
 * the widget cares about, and the widget the user is about to focus is a
 * different page (and will run its own check-cdp on its own ws connection).
 */
async function handleFocusDebug(
  ws: WebSocket,
  msg: ClientMessage,
  cdpUrl: string,
): Promise<void> {
  const pageUrl = msg.payload?.pageUrl;
  if (typeof pageUrl !== 'string' || !pageUrl) {
    send(ws, { type: 'error', payload: { message: 'focus-debug: pageUrl is required' } });
    return;
  }
  const result = await focusDebugTab(cdpUrl, pageUrl);
  if (!result.ok) {
    send(ws, { type: 'error', payload: { message: `focus-debug: ${result.reason}` } });
  }
}

async function handleSaveSpec(
  ws: WebSocket,
  msg: ClientMessage,
  devRoot: string,
): Promise<void> {
  const name = msg.payload?.name;
  const description = msg.payload?.description ?? '';
  const steps = msg.payload?.steps;
  const assertions = msg.payload?.assertions ?? [];

  if (typeof name !== 'string' || !name.trim()) {
    send(ws, { type: 'error', payload: { message: 'save-spec: name is required' } });
    return;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    send(ws, { type: 'error', payload: { message: 'save-spec: no steps to save' } });
    return;
  }
  const overwrite = msg.payload?.overwrite === true;

  try {
    const result = await writeSpec({ devRoot, name, description, steps, assertions, overwrite });
    send(ws, {
      type: 'spec-saved',
      payload: { name: result.slug, path: result.path },
    });
  } catch (err) {
    if (err instanceof SpecExistsError) {
      send(ws, {
        type: 'spec-exists',
        payload: { slug: err.slug, existingPath: err.path },
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(ws, {
      type: 'error',
      payload: { message: `save-spec failed: ${message}` },
    });
  }
}

async function handleSaveCaseCsv(
  ws: WebSocket,
  msg: ClientMessage,
  devRoot: string,
): Promise<void> {
  const name = msg.payload?.name;
  const description = msg.payload?.description ?? '';
  const steps = msg.payload?.steps;
  const assertions = msg.payload?.assertions ?? [];
  const jiraProjectKey = msg.payload?.jiraProjectKey;
  const labels = msg.payload?.labels;

  if (typeof name !== 'string' || !name.trim()) {
    send(ws, { type: 'error', payload: { message: 'save-case-csv: name is required' } });
    return;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    send(ws, { type: 'error', payload: { message: 'save-case-csv: no steps to save' } });
    return;
  }
  const overwrite = msg.payload?.overwrite === true;

  try {
    const result = await writeCaseCsv({
      devRoot, name, description, steps, assertions,
      jiraProjectKey, labels, overwrite,
    });
    send(ws, {
      type: 'case-csv-saved',
      payload: { name: result.slug, path: result.path },
    });
  } catch (err) {
    if (err instanceof CaseCsvExistsError) {
      send(ws, {
        type: 'case-csv-exists',
        payload: { slug: err.slug, existingPath: err.path },
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(ws, {
      type: 'error',
      payload: { message: `save-case-csv failed: ${message}` },
    });
  }
}

async function handleSaveSkill(
  ws: WebSocket,
  msg: ClientMessage,
  devRoot: string,
): Promise<void> {
  const name = msg.payload?.name;
  const description = msg.payload?.description ?? '';
  const steps = msg.payload?.steps;

  if (typeof name !== 'string' || !name.trim()) {
    send(ws, { type: 'error', payload: { message: 'save-skill: name is required' } });
    return;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    send(ws, { type: 'error', payload: { message: 'save-skill: no steps to save' } });
    return;
  }

  const overwrite = msg.payload?.overwrite === true;

  try {
    const result = await writeSkill({ devRoot, name, description, steps, overwrite });
    send(ws, {
      type: 'skill-saved',
      payload: { name: result.slug, path: result.path },
    });
    // Push a fresh list so the widget's skills overlay updates without a
    // round-trip — most relevant right after the save.
    const skills = await listSkills(devRoot);
    send(ws, { type: 'skills-list', payload: { skills } });
  } catch (err) {
    if (err instanceof SkillExistsError) {
      send(ws, {
        type: 'skill-exists',
        payload: { slug: err.slug, existingPath: err.path },
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    send(ws, {
      type: 'error',
      payload: { message: `save-skill failed: ${message}` },
    });
  }
}
