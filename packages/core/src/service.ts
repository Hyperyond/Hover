/**
 * Local Hover WebSocket service.
 *
 * One process per Vite dev server. Started by @hover/vite-plugin's
 * configureServer hook, torn down on closeBundle. Binds to 127.0.0.1 only.
 *
 * Wire protocol (newline-free JSON over WebSocket):
 *
 *   server → client
 *     { type: 'hello',        payload: { agentId, model, version } }
 *     { type: 'event',        payload: InvokeEvent }              // see agents/types.ts
 *     { type: 'skill-saved',  payload: { name, path } }
 *     { type: 'skill-exists', payload: { slug, existingPath } }
 *     { type: 'skills-list',  payload: { skills: SkillSummary[] } }
 *     { type: 'spec-saved',   payload: { name, path } }
 *     { type: 'spec-exists',  payload: { slug, existingPath } }
 *     { type: 'error',        payload: { message } }
 *
 *   client → server
 *     { type: 'command',     payload: { text, sessionId? } }
 *     { type: 'cancel' }
 *     { type: 'save-skill',  payload: { name, description, steps, overwrite? } }
 *     { type: 'save-spec',   payload: { name, description, steps, assertions?, overwrite? } }
 *     { type: 'list-skills' }
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { invokeAgent } from './agents/invoke.js';
import type { InvokeEvent } from './agents/types.js';
import { preflightCDP } from './playwright/preflight.js';
import {
  writeSkill,
  listSkills,
  SkillExistsError,
  type SkillStep,
} from './skills/writeSkill.js';
import { writeSpec, SpecExistsError, type SpecAssertion } from './specs/writeSpec.js';

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
  };
}

const PROTOCOL_VERSION = 1;

export function startService(opts: ServiceOptions): ServiceHandle {
  const port = opts.port;
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  const maxBudgetUsd = opts.maxBudgetUsd ?? 0.5;
  const mcpConfig = opts.mcpConfig ?? DEFAULT_MCP_CONFIG;
  const cdpUrl = opts.cdpUrl ?? 'http://localhost:9222';
  const devRoot = opts.devRoot ?? process.cwd();

  const wss = new WebSocketServer({ host: '127.0.0.1', port });

  // Surface bind failures (EADDRINUSE etc.) instead of letting the unhandled
  // 'error' event crash the Vite process. Caller can decide what to do.
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
          allowedTools: ['mcp__playwright'],
          disallowedTools: [
            'Bash', 'BashOutput', 'KillBash',
            'Edit', 'MultiEdit', 'Write', 'Read', 'NotebookEdit',
            'Grep', 'Glob', 'Task', 'TodoWrite',
            'WebFetch', 'WebSearch', 'ExitPlanMode',
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
