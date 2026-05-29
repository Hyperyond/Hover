import type { AgentDescriptor, InvokeOptions, InvokeEvent, ParserState } from './types.js';

/**
 * Cursor CLI agent descriptor (`cursor-agent`, aka `agent`).
 *
 * Wire shape: `cursor-agent -p "<prompt>" --output-format stream-json --force`
 * emits NDJSON on stdout, one event per turn-state change. Documented event
 * types (https://cursor.com/docs/cli/reference/output-format):
 *   - { type: 'system',    subtype: 'init', session_id, model, cwd, ... }
 *   - { type: 'user',      message: { role, content: [{ type:'text', text }] } }
 *   - { type: 'assistant', message: { role, content: [{ type:'text', text }] } }
 *   - { type: 'tool_call', subtype: 'started',   call_id, tool_call: { ... } }
 *   - { type: 'tool_call', subtype: 'completed', call_id, tool_call: { ... } }
 *   - { type: 'result',    subtype: 'success' | ..., duration_ms, is_error, result, session_id }
 *
 * `tool_call.tool_call` shapes vary per tool (`shellToolCall`, `editToolCall`,
 * `readToolCall`, `writeToolCall`, ... — and `mcpToolCall` for MCP server
 * calls). We read defensively because Cursor's docs don't publish the
 * sub-schemas comprehensively yet.
 *
 * Important gaps vs. Claude Code that callers must understand:
 *   1. Soft sandbox only. Cursor exposes `--force` / `--yolo` for non-interactive
 *      approval, but there is NO `--allowedTools` / `--disallowedTools` flag
 *      to disable built-in tools. Its built-in shell / file-edit tools cannot
 *      be disabled at the CLI level. We lean on `--mode=plan` semantics where
 *      appropriate plus an AGENTS.md-style rules injection — the agent CLI
 *      auto-reads `AGENTS.md` / `.cursor/rules` at the project root, so we
 *      emit a `developer_instructions`-equivalent guidance string via the
 *      best available channel (prepended to the prompt). A determined or
 *      hallucinating agent could still try to invoke the built-ins; the
 *      widget marks cursor with a warning indicator alongside codex.
 *   2. No `--max-budget-usd`. Cursor offers no per-invocation $ cap. We just
 *      omit the flag; the widget's running-cost chip + Stop button remain
 *      the user's control.
 *   3. No explicit system-prompt CLI flag. The agent reads `.cursor/rules` /
 *      `AGENTS.md` / `CLAUDE.md` at the workspace root automatically, but we
 *      can't shove session-specific guidance into those without polluting the
 *      user's repo. Instead, we prepend a short HOVER-MODE preface to the
 *      user's prompt — the agent treats it as the leading user-message text
 *      which is the closest functional equivalent. Caller-supplied
 *      `appendSystemPrompt` text is appended to the same preface.
 *   4. `result` events ship `duration_ms` but no token usage or cost. We
 *      cannot estimate $ from token counts the way codex / claude do —
 *      Cursor doesn't publish tokens at all in stream-json. We surface
 *      `turns` only; `costUsd` is left undefined on usage / session_end.
 *      This is honest; the widget should render "–" rather than $0 when
 *      no cost figure exists.
 *   5. The binary is symlinked twice (`agent` and `cursor-agent`) by the
 *      installer at `~/.local/bin`. We probe `cursor-agent` to avoid name
 *      collision with any other tool that ships an `agent` binary.
 */

interface CursorToolCall {
  /** Tool kind discriminator embedded in the wrapper, e.g. `shellToolCall`,
   *  `mcpToolCall`. We don't enumerate — read whatever we get. */
  [k: string]: unknown;
}

interface CursorContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

interface CursorMessage {
  role?: string;
  content?: CursorContentBlock[];
}

interface CursorStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  cwd?: string;
  /** assistant / user message body */
  message?: CursorMessage;
  /** tool_call body — present on both subtype:'started' and subtype:'completed' */
  call_id?: string;
  tool_call?: CursorToolCall;
  /** result event body */
  duration_ms?: number;
  is_error?: boolean;
  result?: string;
}

/**
 * Per-invocation parser state. invokeAgent threads a fresh object through
 * parseEvent / onStreamEnd so two concurrent cursor runs never smear their
 * counters together. Same pattern as codex.ts.
 */
interface CursorParserState extends ParserState {
  runningTurns: number;
  runningSessionId: string | undefined;
  runningModel: string | undefined;
  lastAssistantText: string | undefined;
  sawErrorEvent: boolean;
  /** Per-call_id tool name capture so completion events can resolve back to
   *  the tool that was called, since `tool_call` payloads vary in shape. */
  toolNameByCallId: Map<string, string>;
}

function cursorState(state: ParserState): CursorParserState {
  if (typeof state.runningTurns !== 'number') {
    state.runningTurns = 0;
    state.runningSessionId = undefined;
    state.runningModel = undefined;
    state.lastAssistantText = undefined;
    state.sawErrorEvent = false;
    state.toolNameByCallId = new Map<string, string>();
  }
  return state as CursorParserState;
}

function resetCursorCounters(s: CursorParserState): void {
  s.runningTurns = 0;
  s.runningSessionId = undefined;
  s.runningModel = undefined;
  s.lastAssistantText = undefined;
  s.sawErrorEvent = false;
  s.toolNameByCallId.clear();
}

/**
 * Best-effort extraction of a tool's name from the `tool_call` envelope.
 * Cursor's stream-json wraps each kind in a sub-object keyed by name
 * (`shellToolCall`, `mcpToolCall`, etc.) but doesn't publish a stable
 * `name` field at the top level. We:
 *   1. Look for the first key that ends in `ToolCall` → strip the suffix.
 *      `shellToolCall` → `shell`, `mcpToolCall` → `mcp`.
 *   2. If the sub-object carries a `tool` / `name` field, prefer that
 *      (mcp calls embed the playwright tool name there).
 *   3. Strip the `mcp__playwright__` / `mcp__hover-playwright__` prefix to
 *      match the normalised tool names claude / codex emit.
 */
function extractToolName(tc: CursorToolCall | undefined): { tool: string; input: unknown } {
  if (!tc) return { tool: 'unknown', input: undefined };
  const wrapperKey = Object.keys(tc).find(k => k.endsWith('ToolCall'));
  const inner = (wrapperKey ? (tc[wrapperKey] as Record<string, unknown> | undefined) : undefined) ?? undefined;
  // Prefer the inner sub-tool name if it exists (MCP case).
  const innerName =
    (inner && typeof inner === 'object' && 'tool' in inner && typeof inner.tool === 'string' && inner.tool) ||
    (inner && typeof inner === 'object' && 'name' in inner && typeof inner.name === 'string' && inner.name) ||
    null;
  const kindFromKey = wrapperKey ? wrapperKey.replace(/ToolCall$/, '') : 'unknown';
  const rawName = innerName || kindFromKey;
  const tool = rawName
    .replace(/^mcp__playwright__/, '')
    .replace(/^mcp__hover-playwright__/, '');
  const input =
    (inner && typeof inner === 'object' && 'input' in inner && inner.input) ||
    (inner && typeof inner === 'object' && 'arguments' in inner && inner.arguments) ||
    (inner && typeof inner === 'object' && 'args' in inner && inner.args) ||
    inner;
  return { tool, input };
}

function detectToolError(tc: CursorToolCall | undefined): boolean {
  if (!tc || typeof tc !== 'object') return false;
  const wrapperKey = Object.keys(tc).find(k => k.endsWith('ToolCall'));
  const inner = wrapperKey ? (tc[wrapperKey] as Record<string, unknown> | undefined) : undefined;
  if (!inner) return false;
  if (inner.is_error === true) return true;
  if (typeof inner.status === 'string' && /error|fail/i.test(inner.status)) return true;
  return false;
}

/**
 * The closest analogue Cursor has to claude's --append-system-prompt or
 * codex's developer_instructions. Since there is no CLI flag, we prepend
 * this to the user prompt so the agent sees it as the leading instruction.
 */
const CURSOR_PROMPT_PREFACE = [
  'You are operating in Hover, a browser-testing tool.',
  'Use ONLY the MCP playwright tools (prefixed `mcp__playwright__` / `mcp__hover-playwright__`) to drive the browser.',
  'Do NOT use shell, file-edit, web-search, or any other built-in tool.',
  'Do NOT navigate to a URL the user is already on; check the page state via `browser_snapshot` first.',
  'When the task is complete, emit a short summary and stop.',
].join(' ');

export const cursorAgent: AgentDescriptor = {
  id: 'cursor',
  binName: 'cursor-agent',
  protocol: 'argv',
  streamFormat: 'json-lines',
  sandboxStrength: 'soft',
  display: {
    label: 'Cursor',
    tagline: 'Cursor — soft sandbox (no built-in tool deny-list)',
    homepage: 'https://cursor.com/docs/cli/overview',
    installHint: 'curl https://cursor.com/install -fsS | bash',
  },

  buildArgs(opts: InvokeOptions): string[] {
    // The HOVER-mode preface plus any caller-supplied appendSystemPrompt
    // gets prepended to the prompt. This is the closest functional analogue
    // Cursor has to claude's --append-system-prompt / codex's
    // developer_instructions, because Cursor exposes no CLI flag for it.
    const preface = opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0
      ? `${CURSOR_PROMPT_PREFACE} ${opts.appendSystemPrompt}`
      : CURSOR_PROMPT_PREFACE;
    const finalPrompt = `${preface}\n\n${opts.prompt}`;

    const args: string[] = ['-p', finalPrompt];

    // NDJSON streaming output.
    args.push('--output-format', 'stream-json');

    // Non-interactive: auto-approve commands and MCP tools so the run doesn't
    // hang waiting for permission. Cursor calls this --force / --yolo.
    args.push('--force');

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.sessionId) {
      // Cursor's --resume accepts the chat_id. Empty / no-arg --resume
      // resumes the latest, which is NOT what we want here.
      args.push('--resume', opts.sessionId);
    }

    // MCP servers are configured in ~/.cursor/mcp.json (or repo-local
    // .cursor/mcp.json) at install time, not per-invocation. Cursor has no
    // equivalent of claude's --mcp-config. If the caller passed opts.mcpConfig
    // we don't have a way to forward it; service.ts logs a one-time warning.

    // No equivalent for --max-budget-usd or --allowedTools / --disallowedTools.

    return args;
  },

  parseEvent(line: string, state: ParserState = {}): InvokeEvent[] {
    if (!line.trim()) return [];

    let ev: CursorStreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }

    const s = cursorState(state);
    const out: InvokeEvent[] = [];

    if (ev.type === 'system' && ev.subtype === 'init') {
      resetCursorCounters(s);
      s.runningModel = ev.model;
      if (ev.session_id) {
        s.runningSessionId = ev.session_id;
        out.push({ kind: 'session_start', sessionId: ev.session_id, model: ev.model });
      }
      return out;
    }

    if (ev.type === 'tool_call' && ev.subtype === 'started') {
      const { tool, input } = extractToolName(ev.tool_call);
      if (ev.call_id) s.toolNameByCallId.set(ev.call_id, tool);
      out.push({ kind: 'tool_use', tool, input });
      return out;
    }

    if (ev.type === 'tool_call' && ev.subtype === 'completed') {
      const isError = detectToolError(ev.tool_call);
      out.push({ kind: 'tool_result', isError });
      return out;
    }

    if (ev.type === 'assistant') {
      s.runningTurns += 1;
      // Emit a usage event so the widget can advance its turn counter even
      // though Cursor gives us no token / $ data. costUsd intentionally
      // omitted — we don't fabricate a number.
      out.push({ kind: 'usage', turns: s.runningTurns });

      for (const block of ev.message?.content ?? []) {
        if (block.type === 'text') {
          const text = block.text?.trim();
          if (text) {
            s.lastAssistantText = text;
            out.push({ kind: 'text', text });
          }
        }
      }
      return out;
    }

    if (ev.type === 'result') {
      // Cursor's result event IS the session_end. We forward it directly so
      // onStreamEnd doesn't need to synthesize.
      const isError = ev.is_error === true ||
        (typeof ev.subtype === 'string' && /error|fail/i.test(ev.subtype));
      if (isError) s.sawErrorEvent = true;
      out.push({
        kind: 'session_end',
        turns: s.runningTurns,
        // costUsd intentionally undefined — Cursor doesn't publish $ or tokens.
        isError,
        summary: ev.result ?? s.lastAssistantText,
      });
      return out;
    }

    // Cursor sometimes emits error envelopes mid-stream; surface them as
    // text so the widget shows the problem instead of silently hanging.
    if (ev.type && /error/i.test(ev.type)) {
      s.sawErrorEvent = true;
      // No documented `message` field on these — best-effort.
      const msg = ev.result ?? `[cursor] ${ev.type}`;
      out.push({ kind: 'text', text: msg });
      return out;
    }

    return [];
  },

  /**
   * Cursor's `result` event already produces a session_end via parseEvent;
   * this fallback is for the case where the child exits without emitting a
   * `result` (e.g. crash, signal). Mirrors codex.ts's shape.
   */
  onStreamEnd(exitCode: number | null, state: ParserState = {}): InvokeEvent {
    const s = cursorState(state);
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
 * Test-only escape hatches. Same pattern as codex.ts so the tests can drive
 * the parser without going through invokeAgent.
 */
export const __testing = {
  freshState: (): ParserState => ({}),
  resetCounters: (state: ParserState) => resetCursorCounters(cursorState(state)),
  getState: (state: ParserState) => {
    const s = cursorState(state);
    return {
      runningTurns: s.runningTurns,
      runningSessionId: s.runningSessionId,
      runningModel: s.runningModel,
      lastAssistantText: s.lastAssistantText,
      sawErrorEvent: s.sawErrorEvent,
    };
  },
};
