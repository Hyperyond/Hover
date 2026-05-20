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
 *     { type: 'command', payload: { text } }
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { invokeAgent } from './agents/invoke.js';
import type { InvokeEvent } from './agents/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MCP_CONFIG = resolve(HERE, '..', 'mcp.config.json');

export interface ServiceOptions {
  port: number;
  agentId?: string;
  model?: string;
  maxBudgetUsd?: number;
  mcpConfig?: string;
}

export interface ServiceHandle {
  port: number;
  close(): Promise<void>;
}

interface ClientMessage {
  type: string;
  payload?: { text?: string };
}

const PROTOCOL_VERSION = 1;

export function startService(opts: ServiceOptions): ServiceHandle {
  const port = opts.port;
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  const maxBudgetUsd = opts.maxBudgetUsd ?? 0.5;
  const mcpConfig = opts.mcpConfig ?? DEFAULT_MCP_CONFIG;

  const wss = new WebSocketServer({ host: '127.0.0.1', port });

  wss.on('connection', ws => {
    send(ws, { type: 'hello', payload: { agentId, model, version: PROTOCOL_VERSION } });

    let busy = false;

    ws.on('message', async data => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type !== 'command') return;
      const text = msg.payload?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      if (busy) {
        send(ws, {
          type: 'error',
          payload: { message: 'A command is already running on this connection.' },
        });
        return;
      }

      busy = true;
      try {
        for await (const ev of invokeAgent({
          agentId,
          prompt: text,
          mcpConfig,
          allowedTools: ['mcp__playwright'],
          disallowedTools: [
            'Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob',
            'Task', 'WebFetch', 'WebSearch',
          ],
          maxBudgetUsd,
          model,
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
