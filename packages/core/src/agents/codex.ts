import type { AgentDescriptor, InvokeOptions, InvokeEvent, ParserState } from './types.js';
import { stripMcpPrefix } from './shared.js';

/**
 * OpenAI Codex CLI descriptor.
 *
 * Wire shape: `codex exec [resume <session_id>] "<prompt>" --json` emits
 * JSONL on stdout, one event per turn-state change. Documented event types:
 *   - thread.started        { thread_id }
 *   - turn.started
 *   - item.started          { item: { id, type, ... } }
 *   - item.completed        { item: { id, type, ... } }
 *   - turn.completed        { usage: { input_tokens, output_tokens, ... } }
 * Source: developers.openai.com/codex/noninteractive
 *
 * item.type values relevant to us:
 *   - agent_message         text emitted to the user → InvokeEvent 'text'
 *   - mcp_tool_call         MCP server call → InvokeEvent 'tool_use'/'tool_result'
 *   - command_execution     built-in shell call (we discourage but surface)
 *   - reasoning             internal reasoning trace; not user-visible
 *   - file_changes          built-in file edits; not allowed under our prompt
 *   - web_search            built-in web search
 *   - plan_update           planner output
 *
 * Important gaps vs. Claude Code that callers must understand:
 *   1. Soft sandbox only. Codex has no `--allowedTools` / `--disallowedTools`;
 *      its built-in shell/file-edit tools cannot be disabled at the CLI level.
 *      We pass `--sandbox read-only` (blocks shell side-effects) and inject
 *      a developer_instructions system prompt telling the agent to only call
 *      `mcp__playwright__*` tools. A determined or hallucinating agent could
 *      still try to invoke the built-ins; the widget marks codex with a
 *      warning indicator so the user knows the surface is broader.
 *   2. No `--max-budget-usd`. Codex offers no per-invocation $ cap. We just
 *      omit the flag; the widget's running-cost chip + Stop button remain
 *      the user's control. (A wall-clock timeout could be added later if
 *      we observe runaway sessions empirically.)
 *   3. No `--append-system-prompt` flag. We use `-c developer_instructions=`
 *      to inject session-specific guidance (e.g. "you're already on the dev
 *      URL, don't re-navigate").
 *   4. `usage` events ship token counts only, no `cost_usd`. We compute USD
 *      client-side from a public price table — same approach claude.ts uses
 *      when claude omits its own cost field.
 */

interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface CodexItem {
  id?: string;
  type?: string;
  /** agent_message.text */
  text?: string;
  /** mcp_tool_call shape (empirically — docs don't publish the exact schema
   *  yet, so we read defensively). */
  name?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
  input?: unknown;
  /** command_execution */
  command?: string;
  /** item.completed often carries one of these as the error signal */
  status?: string;
  is_error?: boolean;
  error?: unknown;
}

interface CodexStreamEvent {
  type: string;
  thread_id?: string;
  /** Only present on some events; passed through to the `session_start`
   *  event when codex includes it. Cost estimation does NOT depend on this —
   *  the parser has no access to the invocation's `--model`, so
   *  estimateCostUsd uses a fixed default tier (see estimateCostUsd). */
  model?: string;
  item?: CodexItem;
  usage?: CodexUsage;
  /** Some error events carry a top-level message string. */
  message?: string;
}

/**
 * Pricing per million tokens. Keep in lockstep with claude.ts's table —
 * approximate published OpenAI rates as of 2026. We are deliberately
 * conservative (no cache-hit discount); cost shown to the user is therefore
 * a high-water estimate, which is the right error direction for a "should
 * I hit Stop now" UI signal.
 */
const PRICE_PER_M_USD: Record<string, { in: number; out: number }> = {
  // gpt-5.5 / gpt-5.4 / gpt-5 — public per-million pricing is similar to
  // claude opus; tune empirically when OpenAI publishes a stable price table
  // for the Codex tier specifically.
  'gpt-5.5': { in: 5,  out: 25 },
  'gpt-5.4': { in: 5,  out: 25 },
  'gpt-5':   { in: 5,  out: 25 },
  // gpt-4.x kept for users on legacy --model
  'gpt-4o':  { in: 2.5, out: 10 },
  'gpt-4':   { in: 30,  out: 60 },
};

// `modelHint` is currently always passed as undefined — the parser can't see
// the invocation's --model — so the default tier below is what gets used. The
// parameter is kept so a future caller that does have the model id can pass it.
function estimateCostUsd(modelHint: string | undefined, usage: CodexUsage): number {
  const m = (modelHint ?? 'gpt-5.5').toLowerCase();
  // Match by longest-prefix so 'gpt-5.5-mini' picks up the 'gpt-5.5' tier.
  const tier =
    Object.entries(PRICE_PER_M_USD).find(([key]) => m.startsWith(key))?.[1] ??
    PRICE_PER_M_USD['gpt-5.5'];
  return (
    (usage.input_tokens ?? 0) * tier.in +
    (usage.output_tokens ?? 0) * tier.out
  ) / 1_000_000;
}

/**
 * Per-invocation parser state. invokeAgent threads a fresh object through
 * parseEvent / onStreamEnd so two concurrent codex runs never smear their
 * counters together. The previous module-level globals were a latent bug.
 */
interface CodexParserState extends ParserState {
  runningCost: number;
  runningTurns: number;
  runningTokens: number;
  runningSessionId: string | undefined;
  lastAgentMessage: string | undefined;
  sawErrorEvent: boolean;
  /** Per-item tracking so item.completed can resolve to the matching
   *  item.started type (we don't get the type back on completion for
   *  every item kind). */
  itemTypeById: Map<string, string>;
}

function codexState(state: ParserState): CodexParserState {
  if (typeof state.runningCost !== 'number') {
    state.runningCost = 0;
    state.runningTurns = 0;
    state.runningTokens = 0;
    state.runningSessionId = undefined;
    state.lastAgentMessage = undefined;
    state.sawErrorEvent = false;
    state.itemTypeById = new Map<string, string>();
  }
  return state as CodexParserState;
}

function resetCodexCounters(s: CodexParserState): void {
  s.runningCost = 0;
  s.runningTurns = 0;
  s.runningTokens = 0;
  s.runningSessionId = undefined;
  s.lastAgentMessage = undefined;
  s.sawErrorEvent = false;
  s.itemTypeById.clear();
}

/** Cap surfaced as a constraint in the system prompt — codex has no CLI flag. */
const CODEX_DEVELOPER_INSTRUCTIONS = [
  'You are operating in Hover, a browser-testing tool.',
  'Use ONLY the MCP playwright tools (prefixed `mcp__playwright__` / `mcp__hover-playwright__`) to drive the browser.',
  'Do NOT call shell, file-edit, web-search, or any other built-in tool.',
  'Do NOT navigate to a URL the user is already on; check the page state via `browser_snapshot` first.',
  'When the task is complete, emit a short agent_message summary and stop.',
].join(' ');

export const codexAgent: AgentDescriptor = {
  id: 'codex',
  binName: 'codex',
  protocol: 'argv',
  streamFormat: 'json-lines',
  sandboxStrength: 'soft',
  apiKeyEnv: 'OPENAI_API_KEY',
  display: {
    label: 'OpenAI Codex',
    tagline: 'OpenAI — soft sandbox (no built-in tool deny-list)',
    homepage: 'https://developers.openai.com/codex',
    installHint: 'npm install -g @openai/codex',
  },

  buildArgs(opts: InvokeOptions): string[] {
    const args: string[] = ['exec'];

    // Resume must come BEFORE the prompt positional. `codex exec resume <id>
    // [prompt]` is the documented shape.
    if (opts.sessionId) {
      args.push('resume', opts.sessionId);
    }

    args.push(opts.prompt);

    // JSONL streaming output.
    args.push('--json');

    // Never prompt for approval in headless mode.
    args.push('--ask-for-approval', 'never');

    // Soft sandbox: prevent shell side-effects on disk / network even when
    // the agent tries to call its built-in shell. read-only is the strictest
    // documented level.
    args.push('--sandbox', 'read-only');

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // System-prompt injection. Codex has no --append-system-prompt; we route
    // through `-c developer_instructions='...'`. Concatenate the standing
    // Hover-mode instructions with whatever the caller passes (e.g. "user is
    // already on http://localhost:5173/").
    const sysPrompt = opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0
      ? `${CODEX_DEVELOPER_INSTRUCTIONS} ${opts.appendSystemPrompt}`
      : CODEX_DEVELOPER_INSTRUCTIONS;
    args.push('-c', `developer_instructions=${JSON.stringify(sysPrompt)}`);

    // MCP servers are configured in ~/.codex/config.toml at install time,
    // not per-invocation. If the user passed an mcpConfig path, we don't
    // have a way to forward it to codex — log a warning to stderr from the
    // invoker so the user knows. (See invoke.ts wiring.)

    // No equivalent for --max-budget-usd or --allowedTools.

    return args;
  },

  parseEvent(line: string, state: ParserState = {}): InvokeEvent[] {
    if (!line.trim()) return [];

    let ev: CodexStreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }

    const s = codexState(state);
    const out: InvokeEvent[] = [];

    if (ev.type === 'thread.started') {
      resetCodexCounters(s);
      if (ev.thread_id) {
        s.runningSessionId = ev.thread_id;
        out.push({ kind: 'session_start', sessionId: ev.thread_id, model: ev.model });
      }
      return out;
    }

    if (ev.type === 'item.started' && ev.item) {
      const it = ev.item;
      if (it.id && it.type) s.itemTypeById.set(it.id, it.type);

      if (it.type === 'mcp_tool_call') {
        // The exact field names aren't published. Read defensively: prefer
        // `name`, fall back to `tool`. Same for input.
        const rawName = it.name ?? it.tool ?? '';
        const tool = stripMcpPrefix(rawName);
        out.push({ kind: 'tool_use', tool, input: it.input ?? it.arguments, costUsdSnapshot: s.runningCost, tokensSnapshot: s.runningTokens });
      } else if (it.type === 'command_execution') {
        // We DISCOURAGED this in developer_instructions but the agent can
        // still try. Surface it so the user sees it happen.
        out.push({ kind: 'tool_use', tool: 'shell', input: { command: it.command }, costUsdSnapshot: s.runningCost, tokensSnapshot: s.runningTokens });
      }
      return out;
    }

    if (ev.type === 'item.completed' && ev.item) {
      const it = ev.item;
      const recordedType = (it.id && s.itemTypeById.get(it.id)) || it.type;

      if (recordedType === 'agent_message') {
        const text = it.text?.trim();
        if (text) {
          s.lastAgentMessage = text;
          out.push({ kind: 'text', text });
        }
      } else if (recordedType === 'mcp_tool_call' || recordedType === 'command_execution') {
        const isError = it.is_error === true ||
          (typeof it.status === 'string' && /error|fail/i.test(it.status));
        out.push({ kind: 'tool_result', isError });
      }
      return out;
    }

    if (ev.type === 'turn.completed') {
      s.runningTurns += 1;
      if (ev.usage) {
        // The parser has no access to the invocation's --model, so we let
        // estimateCostUsd fall back to its fixed default tier. Cost is a
        // high-water "should I hit Stop now" signal, not an invoice.
        s.runningCost += estimateCostUsd(undefined, ev.usage);
        s.runningTokens += (ev.usage.input_tokens ?? 0) + (ev.usage.output_tokens ?? 0);
      }
      out.push({ kind: 'usage', costUsd: s.runningCost, turns: s.runningTurns, tokens: s.runningTokens });
      return out;
    }

    // Codex emits various error envelopes; we conservatively match anything
    // whose `type` contains 'error' or carries a top-level message string.
    if (ev.type && /error/i.test(ev.type)) {
      s.sawErrorEvent = true;
      if (ev.message) {
        out.push({ kind: 'text', text: `[codex] ${ev.message}` });
      }
      return out;
    }

    return [];
  },

  /**
   * Codex doesn't emit a `session_end` line — the child process simply
   * exits after the final `turn.completed`. We synthesize the terminator
   * here so the widget sees the same shape it sees from claude.
   */
  onStreamEnd(exitCode: number | null, state: ParserState = {}): InvokeEvent {
    const s = codexState(state);
    return {
      kind: 'session_end',
      turns: s.runningTurns,
      costUsd: s.runningCost,
      tokens: s.runningTokens,
      isError: s.sawErrorEvent || (exitCode != null && exitCode !== 0),
      summary: s.lastAgentMessage,
    };
  },
};

/**
 * Test-only escape hatches. Tests pass a state object in and get the
 * accumulated counters back — same shape as the parser sees during a real
 * invocation, just driven by the test instead of by invokeAgent.
 */
export const __testing = {
  freshState: (): ParserState => ({}),
  resetCounters: (state: ParserState) => resetCodexCounters(codexState(state)),
  getState: (state: ParserState) => {
    const s = codexState(state);
    return {
      runningCost: s.runningCost,
      runningTurns: s.runningTurns,
      runningSessionId: s.runningSessionId,
      lastAgentMessage: s.lastAgentMessage,
      sawErrorEvent: s.sawErrorEvent,
    };
  },
};
