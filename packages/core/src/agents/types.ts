/**
 * Local CLI Agent First — agent abstraction layer.
 *
 * Hover does not bundle any AI runtime. It spawns whatever coding-agent CLI the
 * user has on PATH (`claude`, `codex`, `cursor`, `aider`, ...) and treats it as
 * a strategy implementation behind this interface.
 *
 * To add a new agent: write an AgentDescriptor and register it in registry.ts.
 */

export type AgentProtocol =
  | 'argv'     // prompt passed as a CLI flag (e.g. `claude -p "..."`)
  | 'stdin'    // prompt piped into stdin (e.g. `cat | aider`)
  | 'acp'      // Agent Client Protocol (Zed, etc.)
  | 'pi-rpc';  // process-intercom RPC

export type StreamFormat =
  | 'stream-json' // newline-delimited JSON events (claude)
  | 'sse'         // Server-Sent Events
  | 'plain-text'  // unstructured stdout
  | 'json-lines'; // generic NDJSON

export class UnsupportedAgentProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedAgentProtocolError';
  }
}

export class AgentNotInstalledError extends Error {
  constructor(public readonly agentId: string) {
    super(`Agent "${agentId}" is not installed (binary not found on PATH).`);
    this.name = 'AgentNotInstalledError';
  }
}

export interface InvokeOptions {
  agentId: string;
  prompt: string;
  mcpConfig?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxBudgetUsd?: number;
  model?: string;
  cwd?: string;
  sessionId?: string;
  /** Extra text appended to the agent's system prompt (claude: via
   *  --append-system-prompt). Used to inject session-specific context like
   *  "the user's current Chrome tab is already on http://localhost:5173/,
   *  don't browser_navigate there". */
  appendSystemPrompt?: string;
  /** Aborts the spawned child if signaled. Used to stop an orphan run when
   *  the WebSocket caller disconnects (e.g. user reloads the dev page). */
  signal?: AbortSignal;
}

/**
 * Normalized event emitted by every agent, regardless of its native wire format.
 * Each agent's `parseEvent` translates its own stream into these.
 */
export type InvokeEvent =
  | { kind: 'session_start'; sessionId: string; model?: string }
  | { kind: 'mcp_status'; server: string; status: string }
  | { kind: 'tool_use'; tool: string; input: unknown }
  | { kind: 'tool_result'; isError?: boolean; preview?: string }
  | { kind: 'text'; text: string }
  /** Running cost / turn-count update emitted mid-session so the widget can
   *  show a live $ counter without waiting for session_end. Claude Code's
   *  stream-json includes `total_cost_usd` on intermediate result-ish events;
   *  agents that don't surface running cost simply never emit this. */
  | { kind: 'usage'; costUsd?: number; turns?: number }
  | { kind: 'session_end'; turns?: number; costUsd?: number; isError?: boolean; summary?: string }
  | { kind: 'raw'; line: string };

export interface AgentDescriptor {
  id: string;
  binName: string;
  protocol: AgentProtocol;
  streamFormat: StreamFormat;
  buildArgs(opts: InvokeOptions): string[];
  parseEvent(line: string): InvokeEvent[];
}
