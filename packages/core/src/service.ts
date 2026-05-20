/**
 * Local Hover WebSocket service.
 *
 * One process per Vite dev server. Started by @hover/vite-plugin's
 * configureServer hook, torn down on closeBundle. Binds to 127.0.0.1 only.
 *
 * Wire protocol (newline-free JSON over WebSocket):
 *
 *   server → client
 *     { type: 'hello',   payload: { agentId, model, version } }
 *     { type: 'event',   payload: InvokeEvent }              // see agents/types.ts
 *     { type: 'error',   payload: { message } }
 *
 *   client → server
 *     { type: 'command', payload: { text, sessionId? } }
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { invokeAgent } from './agents/invoke.js';
import type { InvokeEvent } from './agents/types.js';
import { preflightCDP } from './playwright/preflight.js';

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
}

export interface ServiceHandle {
  port: number;
  close(): Promise<void>;
}

interface ClientMessage {
  type: string;
  payload?: { text?: string; sessionId?: string };
}

const PROTOCOL_VERSION = 1;

export function startService(opts: ServiceOptions): ServiceHandle {
  const port = opts.port;
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  const maxBudgetUsd = opts.maxBudgetUsd ?? 0.5;
  const mcpConfig = opts.mcpConfig ?? DEFAULT_MCP_CONFIG;
  const cdpUrl = opts.cdpUrl ?? 'http://localhost:9222';

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

    // If the page reloads (e.g. AI navigated to a same-origin URL), the WS
    // connection drops. Abort the in-flight agent so we don't leave an
    // orphan claude process driving the now-vanished browser tab.
    ws.on('close', () => {
      inflight?.abort();
    });

    ws.on('message', async data => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
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

        for await (const ev of invokeAgent({
          agentId,
          prompt: text,
          sessionId: resumeSessionId,
          mcpConfig,
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
          if (ws.readyState !== WebSocket.OPEN) return;
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
