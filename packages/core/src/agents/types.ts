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
  /** Optional model API key. Injected into the spawned CLI's environment under
   *  the descriptor's `apiKeyEnv` var (e.g. ANTHROPIC_API_KEY) so a user without
   *  a logged-in subscription can drive Hover with their own key. Never logged,
   *  never persisted server-side — held only for the lifetime of the spawn. */
  apiKey?: string;
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
  | { kind: 'tool_use'; tool: string; input: unknown; costUsdSnapshot?: number; tokensSnapshot?: number }
  | { kind: 'tool_result'; isError?: boolean; preview?: string }
  | { kind: 'text'; text: string }
  /** Running cost / turn-count update emitted mid-session so the widget can
   *  show a live $ counter without waiting for session_end. Claude Code's
   *  stream-json includes `total_cost_usd` on intermediate result-ish events;
   *  agents that don't surface running cost simply never emit this. */
  | { kind: 'usage'; costUsd?: number; turns?: number; tokens?: number }
  /** End-of-session event. Three terminal states the widget renders distinctly:
   *
   *   - normal completion: `isError: false`, no `cancelled` flag
   *   - agent / runtime failure: `isError: true`, no `cancelled` flag
   *   - user-initiated stop: `cancelled: true` (and we leave `isError: false`
   *     so downstream "did the agent fail?" predicates don't conflate
   *     "user pressed Stop" with "agent crashed mid-run"). The widget
   *     renders this as a neutral "Stopped" state, not a red Failed card.
   */
  | { kind: 'session_end'; turns?: number; costUsd?: number; tokens?: number; isError?: boolean; cancelled?: boolean; summary?: string }
  | { kind: 'raw'; line: string };

/**
 * How tightly the agent's tool surface can be locked down per invocation.
 *
 *   'hard' — the agent CLI accepts a deny-list / allow-list that effectively
 *            removes built-in tools (shell, file edit, etc.) so the only
 *            callable surface is whatever MCP servers we configure. Claude
 *            Code's `--strict-mcp-config` + `--allowedTools mcp__playwright`
 *            + `--disallowedTools <every built-in>` is the canonical example.
 *
 *   'soft' — the agent CLI does not expose a way to disable its built-in
 *            tools (shell, fs). We can constrain side-effects via OS-level
 *            sandbox flags (e.g. codex's `--sandbox read-only`) and we lean
 *            on a strict `developer_instructions` system-prompt to nudge the
 *            agent toward MCP-only behavior, but a determined / hallucinating
 *            agent COULD still try a built-in shell call. The widget should
 *            mark this agent with a warning indicator.
 */
export type SandboxStrength = 'hard' | 'soft';

/**
 * Human-facing metadata for the widget's agent picker. None of these affect
 * agent invocation — they only shape how the agent is presented in the UI.
 */
export interface AgentDisplay {
  /** Pretty name for the dropdown ("Claude Code", "OpenAI Codex"). */
  label: string;
  /** One-line tagline shown under the label. */
  tagline?: string;
  /** Vendor / source URL — clicking the agent name in the widget can open
   *  this in a new tab when the agent isn't installed. */
  homepage?: string;
  /** Shell command the user can run to install (copy-paste from a tooltip
   *  in the widget when the agent is listed but not on PATH). */
  installHint?: string;
}

/**
 * Per-invocation parser state. A fresh object is created by `invokeAgent`
 * for each spawn and passed to both `parseEvent` and `onStreamEnd`.
 *
 * Descriptors that need to accumulate state across lines (cost, turn count,
 * last agent message for synthesized session_end, etc.) read and write
 * their own keys on this object. There is no shared shape — each agent
 * uses whatever fields it needs.
 *
 * Why: module-level state in claude.ts / codex.ts worked only because the
 * service enforces one in-flight invocation per Node process. Two concurrent
 * agent runs (future: tests in parallel, in-process workers) would silently
 * smear their cost accumulators together. Threading the state object per
 * invocation removes that hazard at zero runtime cost.
 */
export type ParserState = Record<string, unknown>;

export interface AgentDescriptor {
  id: string;
  binName: string;
  protocol: AgentProtocol;
  streamFormat: StreamFormat;
  sandboxStrength: SandboxStrength;
  display: AgentDisplay;
  /** Hard-sandbox agents pass this list to `disallowedTools` when the
   *  service-level allow/deny config isn't explicitly overridden. Lets the
   *  per-CLI deny list live alongside its descriptor instead of as a magic
   *  array in the service. Soft-sandbox agents leave this undefined. */
  defaultDisallowedTools?: readonly string[];
  /** Environment variable this CLI reads its model API key from
   *  (claude: ANTHROPIC_API_KEY, codex: OPENAI_API_KEY). When set and the
   *  caller supplies `InvokeOptions.apiKey`, the key is injected into the spawn
   *  env so the user can run on a raw key instead of a logged-in subscription.
   *  Undefined for agents that have no API-key env path. */
  apiKeyEnv?: string;
  buildArgs(opts: InvokeOptions): string[];
  /**
   * Parse a single line of agent stdout into normalised InvokeEvents.
   * `state` is a per-invocation scratch pad (see ParserState). Optional
   * for callers that don't accumulate across lines (and for unit tests
   * that don't care about cost / turn carry-over) — descriptors that
   * DO accumulate must check / initialise the state object themselves.
   */
  parseEvent(line: string, state?: ParserState): InvokeEvent[];
  /**
   * Optional. Called once after the agent's stream closes, with the child's
   * exit code (or null if it was aborted). Lets agents whose protocol does
   * NOT emit an explicit session-terminating event synthesize one from
   * accumulated parser state. Returns `null` if the agent's own `parseEvent`
   * already emitted a `session_end` and nothing further is needed.
   *
   * Used by codex.ts (no native session_end). Claude does not implement
   * this — `result` events terminate naturally.
   */
  onStreamEnd?(exitCode: number | null, state?: ParserState): InvokeEvent | null;
}
