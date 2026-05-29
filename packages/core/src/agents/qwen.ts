import type { AgentDescriptor, InvokeOptions, InvokeEvent, ParserState } from './types.js';

/**
 * Qwen Code CLI descriptor (`qwen`, https://github.com/QwenLM/qwen-code).
 *
 * Wire shape: `qwen -p "<prompt>" --output-format stream-json --yolo` emits
 * line-delimited JSON on stdout, one event per turn-state change. Source:
 * https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/
 * (verified 2026-05).
 *
 * Documented event types (the stream-json shape is largely lifted from
 * Claude Code / Anthropic Messages SDK — qwen-code is itself a soft fork of
 * gemini-cli and adopted the same envelope vocabulary):
 *   - { type: 'system',    subtype: 'session_start', session_id, model, uuid, ... }
 *   - { type: 'assistant', session_id, message: { role, content: [...], usage }, parent_tool_use_id }
 *   - { type: 'user',      session_id, message: { role, content: [...] }, parent_tool_use_id }
 *   - { type: 'result',    subtype: 'success' | 'error_*', session_id, is_error, duration_ms, result, usage }
 *   - tool calls land as `content` blocks of `type: 'tool_use'` inside an
 *     `assistant` message; tool results land as `content` blocks of
 *     `type: 'tool_result'` inside a `user` message. (Same as Anthropic's
 *     Messages API streaming shape.)
 *
 * When `--include-partial-messages` is set, additional `message_start` /
 * `content_block_delta` events stream in real time. We do NOT enable that
 * by default — Hover's widget renders complete tool_use / tool_result events
 * not character-by-character deltas, and the partial-message stream would
 * just bloat the WebSocket bridge with state the UI throws away.
 *
 * Important gaps vs. Claude Code that callers must understand:
 *   1. Soft sandbox only. Qwen Code has no `--allowedTools` /
 *      `--disallowedTools` flag. Its built-in tools (`read_file`,
 *      `write_file`, `edit`, `run_shell_command`, etc., 13 in total) cannot
 *      be disabled at the CLI level. `--yolo` (or `--approval-mode=yolo`)
 *      auto-approves them without OS-level sandboxing — qwen docs are
 *      explicit: "`--yolo` does NOT enable a sandbox". A determined or
 *      hallucinating agent could still try to invoke the built-ins; the
 *      widget marks qwen with a warning indicator alongside codex / cursor.
 *      `--exclude-tools` (settings-key) is technically a partial deny-list
 *      but it's a settings-file knob, not a per-invocation CLI flag, so we
 *      can't use it the way we use claude's --disallowedTools.
 *   2. No `--max-budget-usd`. Qwen does ship run-level budgets that we
 *      could expose (`--max-wall-time`, `--max-tool-calls`,
 *      `--max-session-turns`) but those are not USD ceilings — wall-clock /
 *      tool-call caps. We omit them by default; callers can pass them via
 *      env if needed.
 *   3. **Native `--append-system-prompt` flag exists.** Unlike cursor /
 *      aider, we use the real flag instead of prepending to the user
 *      prompt — cleaner and the agent treats it as a system instruction
 *      proper. `--system-prompt` (no `--append-`) replaces the built-in
 *      prompt entirely; we never want that, so we always use `--append-`.
 *   4. `usage` blocks on assistant / result events ship token counts.
 *      Cost in USD is not in the stream because Qwen models are typically
 *      consumed via Alibaba Model Studio / DashScope and pricing varies
 *      per provider tier. We surface `turns` only; `costUsd` is left
 *      undefined on usage / session_end. The widget should render "–"
 *      rather than $0 when no cost figure exists, same as cursor.
 *   5. Session resumption uses `--resume <sessionId>` or `--continue`
 *      (most recent). Sessions are project-scoped JSONL under
 *      `~/.qwen/projects/<sanitized-cwd>/chats`.
 *   6. MCP servers are configured in `~/.qwen/settings.json` `mcpServers`
 *      key at install time, not per-invocation. Same constraint as cursor
 *      and codex — no `--mcp-config` flag. If the caller passed
 *      `opts.mcpConfig` we don't have a way to forward it.
 */

interface QwenContentBlock {
  type: string;
  text?: string;
  /** tool_use content block */
  name?: string;
  input?: unknown;
  id?: string;
  /** tool_result content block */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [k: string]: unknown;
}

interface QwenUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface QwenMessage {
  id?: string;
  role?: string;
  model?: string;
  content?: QwenContentBlock[];
  usage?: QwenUsage;
}

interface QwenStreamEvent {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  model?: string;
  message?: QwenMessage;
  /** result event body */
  is_error?: boolean;
  duration_ms?: number;
  result?: string;
  usage?: QwenUsage;
  /** Sometimes error envelopes carry a top-level message string. */
  text?: string;
  error?: { message?: string; [k: string]: unknown };
}

/**
 * Per-invocation parser state. Same threading pattern as codex.ts /
 * cursor.ts — fresh object per spawn so two concurrent runs don't smear.
 */
interface QwenParserState extends ParserState {
  runningTurns: number;
  runningSessionId: string | undefined;
  runningModel: string | undefined;
  lastAssistantText: string | undefined;
  sawErrorEvent: boolean;
  /** tool_use id -> stripped tool name. Used so subsequent tool_result
   *  blocks can be matched back to the tool that was called. */
  toolNameByUseId: Map<string, string>;
}

function qwenState(state: ParserState): QwenParserState {
  if (typeof state.runningTurns !== 'number') {
    state.runningTurns = 0;
    state.runningSessionId = undefined;
    state.runningModel = undefined;
    state.lastAssistantText = undefined;
    state.sawErrorEvent = false;
    state.toolNameByUseId = new Map<string, string>();
  }
  return state as QwenParserState;
}

function resetQwenCounters(s: QwenParserState): void {
  s.runningTurns = 0;
  s.runningSessionId = undefined;
  s.runningModel = undefined;
  s.lastAssistantText = undefined;
  s.sawErrorEvent = false;
  s.toolNameByUseId.clear();
}

/** Strip the `mcp__playwright__` / `mcp__hover-playwright__` prefix so tool
 *  names match the normalised names claude / codex / cursor emit. */
function stripMcpPrefix(raw: string): string {
  return raw.replace(/^mcp__playwright__/, '').replace(/^mcp__hover-playwright__/, '');
}

const QWEN_PROMPT_PREFACE = [
  'You are operating in Hover, a browser-testing tool.',
  'Use ONLY the MCP playwright tools (prefixed `mcp__playwright__` / `mcp__hover-playwright__`) to drive the browser.',
  'Do NOT use shell, file-edit, web-search, or any other built-in tool.',
  'Do NOT navigate to a URL the user is already on; check the page state via `browser_snapshot` first.',
  'When the task is complete, emit a short summary and stop.',
].join(' ');

export const qwenAgent: AgentDescriptor = {
  id: 'qwen',
  binName: 'qwen',
  protocol: 'argv',
  streamFormat: 'json-lines',
  sandboxStrength: 'soft',
  display: {
    label: 'Qwen Code',
    tagline: 'Qwen Code — soft sandbox (no built-in tool deny-list)',
    homepage: 'https://github.com/QwenLM/qwen-code',
    installHint: 'npm install -g @qwen-code/qwen-code@latest',
  },

  buildArgs(opts: InvokeOptions): string[] {
    const args: string[] = ['-p', opts.prompt];

    // NDJSON streaming output.
    args.push('--output-format', 'stream-json');

    // Auto-approve all tool calls so the run doesn't hang. The newer
    // canonical form is --approval-mode=yolo; --yolo is deprecated but
    // still works in 2026-05. We use the modern form.
    args.push('--approval-mode', 'yolo');

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.sessionId) {
      // --resume <sessionId> is the documented headless form. --continue
      // (no arg) picks the most recent — NOT what we want when a specific
      // session was passed.
      args.push('--resume', opts.sessionId);
    }

    // Qwen has a real --append-system-prompt flag — use it instead of
    // prepending to the user prompt. Concatenate the standing Hover-mode
    // preface with whatever the caller appended.
    const sysPrompt = opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0
      ? `${QWEN_PROMPT_PREFACE} ${opts.appendSystemPrompt}`
      : QWEN_PROMPT_PREFACE;
    args.push('--append-system-prompt', sysPrompt);

    // MCP servers configured in ~/.qwen/settings.json — no per-invocation
    // --mcp-config equivalent. Same constraint as cursor / codex.

    // No equivalent for --max-budget-usd or --allowedTools / --disallowedTools.

    return args;
  },

  parseEvent(line: string, state: ParserState = {}): InvokeEvent[] {
    if (!line.trim()) return [];

    let ev: QwenStreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }

    const s = qwenState(state);
    const out: InvokeEvent[] = [];

    if (ev.type === 'system' && ev.subtype === 'session_start') {
      resetQwenCounters(s);
      s.runningModel = ev.model;
      if (ev.session_id) {
        s.runningSessionId = ev.session_id;
        out.push({ kind: 'session_start', sessionId: ev.session_id, model: ev.model });
      }
      return out;
    }

    if (ev.type === 'assistant' && ev.message) {
      s.runningTurns += 1;
      // Emit a usage event so the widget can advance its turn counter.
      // costUsd intentionally omitted — qwen doesn't publish $ in stream.
      out.push({ kind: 'usage', turns: s.runningTurns });

      for (const block of ev.message.content ?? []) {
        if (block.type === 'text') {
          const text = block.text?.trim();
          if (text) {
            s.lastAssistantText = text;
            out.push({ kind: 'text', text });
          }
        } else if (block.type === 'tool_use') {
          const rawName = block.name ?? '';
          const tool = stripMcpPrefix(rawName);
          if (block.id) s.toolNameByUseId.set(block.id, tool);
          out.push({ kind: 'tool_use', tool, input: block.input });
        }
      }
      return out;
    }

    // tool_result blocks are wrapped in `user` messages (Anthropic Messages
    // convention). We surface them as tool_result events.
    if (ev.type === 'user' && ev.message) {
      for (const block of ev.message.content ?? []) {
        if (block.type === 'tool_result') {
          const isError = block.is_error === true;
          out.push({ kind: 'tool_result', isError });
        }
      }
      return out;
    }

    if (ev.type === 'result') {
      const isError = ev.is_error === true ||
        (typeof ev.subtype === 'string' && /error|fail/i.test(ev.subtype));
      if (isError) s.sawErrorEvent = true;
      out.push({
        kind: 'session_end',
        turns: s.runningTurns,
        // costUsd intentionally undefined — qwen doesn't publish $.
        isError,
        summary: ev.result ?? s.lastAssistantText,
      });
      return out;
    }

    // Qwen emits various error envelopes mid-stream; surface them as text.
    if (ev.type && /error/i.test(ev.type)) {
      s.sawErrorEvent = true;
      const msg = ev.error?.message ?? ev.text ?? ev.result ?? `[qwen] ${ev.type}`;
      out.push({ kind: 'text', text: msg });
      return out;
    }

    return [];
  },

  /**
   * Qwen's `result` event already produces a session_end via parseEvent;
   * this fallback is for the case where the child exits without emitting a
   * `result` (e.g. crash, signal). Mirrors codex.ts / cursor.ts shape.
   */
  onStreamEnd(exitCode: number | null, state: ParserState = {}): InvokeEvent {
    const s = qwenState(state);
    return {
      kind: 'session_end',
      turns: s.runningTurns,
      // costUsd intentionally undefined — see parseEvent note.
      isError: s.sawErrorEvent || (exitCode != null && exitCode !== 0),
      summary: s.lastAssistantText,
    };
  },
};

/**
 * Test-only escape hatches, same pattern as cursor.ts / codex.ts.
 */
export const __testing = {
  freshState: (): ParserState => ({}),
  resetCounters: (state: ParserState) => resetQwenCounters(qwenState(state)),
  getState: (state: ParserState) => {
    const s = qwenState(state);
    return {
      runningTurns: s.runningTurns,
      runningSessionId: s.runningSessionId,
      runningModel: s.runningModel,
      lastAssistantText: s.lastAssistantText,
      sawErrorEvent: s.sawErrorEvent,
    };
  },
};
