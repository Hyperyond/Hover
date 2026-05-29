import type { AgentDescriptor, InvokeOptions, InvokeEvent, ParserState } from './types.js';

/**
 * Google Gemini CLI descriptor (`gemini`, https://github.com/google-gemini/gemini-cli).
 *
 * Wire shape: `gemini -p "<prompt>" --output-format stream-json --approval-mode yolo`
 * emits line-delimited JSON on stdout, one event per turn-state change. Source:
 * https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
 * (verified 2026-05).
 *
 * Documented event types (top-level `type` field — gemini-cli uses a shorter
 * vocabulary than claude / qwen):
 *   - { type: 'init',        session_id, model, ... }
 *   - { type: 'message',     role: 'assistant' | 'user', content: ... }
 *   - { type: 'tool_use',    name, input, id }
 *   - { type: 'tool_result', tool_use_id, content, is_error }
 *   - { type: 'error',       message, ... }
 *   - { type: 'result',      response, stats, error? }
 *
 * Important gaps vs. Claude Code that callers must understand:
 *   1. Soft sandbox only. Gemini CLI has no `--allowedTools` /
 *      `--disallowedTools` flag that disables built-in tools the way claude
 *      does. The `--allowed-tools` flag is documented as a CONFIRMATION
 *      bypass list (tools that can run without the user clicking approve),
 *      and the policy-engine deprecation note makes this explicit. There is
 *      also `--allowed-mcp-server-names` but that only filters MCP servers
 *      by name; it does NOT lock the agent to a single tool surface. We use
 *      `--approval-mode yolo` to auto-approve so the run doesn't hang, but
 *      shell / file-edit built-ins remain callable. The widget marks gemini
 *      with a warning indicator alongside codex / cursor / qwen / aider.
 *   2. **No `--system-prompt` or `--append-system-prompt` CLI flag.** The
 *      system-prompt override mechanism is via the `GEMINI_SYSTEM_MD`
 *      environment variable pointing at a Markdown file — it's a full
 *      REPLACEMENT (not append) and requires writing a file to disk. We
 *      cannot use it per-invocation without polluting the user's project,
 *      so we fall back to the cursor / aider pattern: prepend the HOVER-MODE
 *      preface to the user prompt. The agent sees it as the leading
 *      user-message text. (Third-party docs occasionally mention
 *      `--system-prompt` / `--append-system-prompt` flags but they do NOT
 *      exist in the upstream CLI as of 2026-05 — verified against the
 *      cli-reference.md in google-gemini/gemini-cli@main.)
 *   3. No `--max-budget-usd`. Gemini ships no per-invocation $ cap.
 *   4. Session resumption uses `--resume <session-id>` or `--resume latest`
 *      (single positional after the flag, NOT a separate `--continue` flag
 *      like qwen). The short alias is `-r`.
 *   5. The `result` event's documented schema is `{ response, stats, error }`
 *      where `stats` contains "session-wide stats, such as duration in
 *      milliseconds, model-related stats, such as the number of turns,
 *      tool-related stats, such as the number of calls" — but does NOT
 *      include USD cost (Google bills per-token via Vertex / Gemini API).
 *      We surface `turns` from stats when present, leave `costUsd`
 *      undefined.
 *   6. MCP servers are configured via `gemini mcp add` commands at install
 *      time (writing into `~/.gemini/settings.json`), not per-invocation.
 *      Same constraint as cursor / codex / qwen — no `--mcp-config` flag.
 *      `--allowed-mcp-server-names` exists but only filters the already-
 *      configured set; it doesn't load new config.
 *   7. Gemini has a `--sandbox` flag (OS-level Docker / Podman sandbox for
 *      shell built-ins) — we deliberately do NOT pass it here because
 *      starting a docker container per invocation adds 1-2s latency and
 *      requires Docker / Podman installed locally. The Hover plugin's
 *      Playwright MCP path doesn't need OS sandboxing. Callers who want
 *      it can set `GEMINI_SANDBOX=1` in their env.
 */

interface GeminiContentBlock {
  type?: string;
  text?: string;
  [k: string]: unknown;
}

interface GeminiStats {
  duration_ms?: number;
  turns?: number;
  /** Some builds nest these one level deeper. Read defensively. */
  model?: { turns?: number; total_tokens?: number };
  tools?: { totalCalls?: number };
  models?: Record<string, { tokens?: { total?: number } }>;
}

interface GeminiStreamEvent {
  type: string;
  session_id?: string;
  model?: string;
  /** message event body — content can be a plain string OR an array of blocks */
  role?: string;
  content?: string | GeminiContentBlock[];
  /** tool_use event body */
  name?: string;
  input?: unknown;
  id?: string;
  /** tool_result event body */
  tool_use_id?: string;
  is_error?: boolean;
  /** error event body */
  message?: string;
  /** result event body */
  response?: string;
  stats?: GeminiStats;
  error?: { message?: string; [k: string]: unknown };
}

/**
 * Per-invocation parser state. Same threading pattern as the other agents.
 */
interface GeminiParserState extends ParserState {
  runningTurns: number;
  runningSessionId: string | undefined;
  runningModel: string | undefined;
  lastAssistantText: string | undefined;
  sawErrorEvent: boolean;
  /** tool_use id -> stripped tool name. Used so tool_result events can be
   *  matched back to the tool that was called (though gemini's tool_result
   *  carries the tool_use_id directly, so this is mostly informational). */
  toolNameByUseId: Map<string, string>;
}

function geminiState(state: ParserState): GeminiParserState {
  if (typeof state.runningTurns !== 'number') {
    state.runningTurns = 0;
    state.runningSessionId = undefined;
    state.runningModel = undefined;
    state.lastAssistantText = undefined;
    state.sawErrorEvent = false;
    state.toolNameByUseId = new Map<string, string>();
  }
  return state as GeminiParserState;
}

function resetGeminiCounters(s: GeminiParserState): void {
  s.runningTurns = 0;
  s.runningSessionId = undefined;
  s.runningModel = undefined;
  s.lastAssistantText = undefined;
  s.sawErrorEvent = false;
  s.toolNameByUseId.clear();
}

/** Strip the `mcp__playwright__` / `mcp__hover-playwright__` prefix so tool
 *  names match the normalised names claude / codex / cursor / qwen emit. */
function stripMcpPrefix(raw: string): string {
  return raw.replace(/^mcp__playwright__/, '').replace(/^mcp__hover-playwright__/, '');
}

/**
 * Extract assistant text from a `message` event whose `content` may be a
 * plain string OR an array of `{type:'text', text}` content blocks. Gemini's
 * docs aren't explicit on which shape ships per build, so we handle both.
 */
function extractMessageText(ev: GeminiStreamEvent): string | undefined {
  if (typeof ev.content === 'string') {
    const t = ev.content.trim();
    return t.length > 0 ? t : undefined;
  }
  if (Array.isArray(ev.content)) {
    const parts = ev.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text!.trim())
      .filter(t => t.length > 0);
    return parts.length > 0 ? parts.join('\n') : undefined;
  }
  return undefined;
}

const GEMINI_PROMPT_PREFACE = [
  'You are operating in Hover, a browser-testing tool.',
  'Use ONLY the MCP playwright tools (prefixed `mcp__playwright__` / `mcp__hover-playwright__`) to drive the browser.',
  'Do NOT use shell, file-edit, web-search, or any other built-in tool.',
  'Do NOT navigate to a URL the user is already on; check the page state via `browser_snapshot` first.',
  'When the task is complete, emit a short summary and stop.',
].join(' ');

export const geminiAgent: AgentDescriptor = {
  id: 'gemini',
  binName: 'gemini',
  protocol: 'argv',
  streamFormat: 'json-lines',
  sandboxStrength: 'soft',
  display: {
    label: 'Gemini',
    tagline: 'Google Gemini — soft sandbox (no built-in tool deny-list)',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    installHint: 'npm install -g @google/gemini-cli',
  },

  buildArgs(opts: InvokeOptions): string[] {
    // Gemini has no --append-system-prompt CLI flag (only the
    // GEMINI_SYSTEM_MD env var which writes a file). Prepend the HOVER-mode
    // preface to the prompt instead — same pattern as cursor.ts / aider.ts.
    const preface = opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0
      ? `${GEMINI_PROMPT_PREFACE} ${opts.appendSystemPrompt}`
      : GEMINI_PROMPT_PREFACE;
    const finalPrompt = `${preface}\n\n${opts.prompt}`;

    const args: string[] = ['-p', finalPrompt];

    // NDJSON streaming output.
    args.push('--output-format', 'stream-json');

    // Auto-approve all tool calls so the run doesn't hang. The newer
    // canonical form is --approval-mode=yolo; --yolo is deprecated but
    // still accepted in 2026-05. We use the modern form.
    args.push('--approval-mode', 'yolo');

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.sessionId) {
      // --resume <id> is the documented form. -r is the alias. The single
      // string 'latest' picks the most recent session; we only pass an
      // explicit id, never the literal 'latest'.
      args.push('--resume', opts.sessionId);
    }

    // MCP servers configured via `gemini mcp add` at install time — no
    // per-invocation --mcp-config equivalent.

    // No equivalent for --max-budget-usd or --allowedTools / --disallowedTools
    // in the disable-built-ins sense.

    return args;
  },

  parseEvent(line: string, state: ParserState = {}): InvokeEvent[] {
    if (!line.trim()) return [];

    let ev: GeminiStreamEvent;
    try {
      ev = JSON.parse(line);
    } catch {
      return [{ kind: 'raw', line }];
    }

    const s = geminiState(state);
    const out: InvokeEvent[] = [];

    if (ev.type === 'init') {
      resetGeminiCounters(s);
      s.runningModel = ev.model;
      if (ev.session_id) {
        s.runningSessionId = ev.session_id;
        out.push({ kind: 'session_start', sessionId: ev.session_id, model: ev.model });
      }
      return out;
    }

    if (ev.type === 'message') {
      // Only count and surface assistant messages — user echoes (the
      // role:'user' message events) don't count as turns from our POV.
      if (ev.role === 'assistant' || ev.role === undefined) {
        s.runningTurns += 1;
        out.push({ kind: 'usage', turns: s.runningTurns });
        const text = extractMessageText(ev);
        if (text) {
          s.lastAssistantText = text;
          out.push({ kind: 'text', text });
        }
      }
      return out;
    }

    if (ev.type === 'tool_use') {
      const rawName = ev.name ?? '';
      const tool = stripMcpPrefix(rawName);
      if (ev.id) s.toolNameByUseId.set(ev.id, tool);
      out.push({ kind: 'tool_use', tool, input: ev.input });
      return out;
    }

    if (ev.type === 'tool_result') {
      const isError = ev.is_error === true;
      out.push({ kind: 'tool_result', isError });
      return out;
    }

    if (ev.type === 'result') {
      // result.stats may carry turns; prefer it over our running count.
      const turns = ev.stats?.turns ?? ev.stats?.model?.turns ?? s.runningTurns;
      const isError = ev.is_error === true || ev.error !== undefined && ev.error !== null;
      if (isError) s.sawErrorEvent = true;
      out.push({
        kind: 'session_end',
        turns,
        // costUsd intentionally undefined — gemini's stats block does not
        // include $ figures.
        isError,
        summary: ev.response ?? s.lastAssistantText,
      });
      return out;
    }

    if (ev.type === 'error') {
      s.sawErrorEvent = true;
      const msg = ev.message ?? ev.error?.message ?? `[gemini] error`;
      out.push({ kind: 'text', text: msg });
      return out;
    }

    return [];
  },

  /**
   * Gemini's `result` event already produces a session_end via parseEvent;
   * this fallback is for the case where the child exits without emitting a
   * `result` (e.g. crash, signal). Same shape as cursor.ts / qwen.ts.
   */
  onStreamEnd(exitCode: number | null, state: ParserState = {}): InvokeEvent {
    const s = geminiState(state);
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
  resetCounters: (state: ParserState) => resetGeminiCounters(geminiState(state)),
  getState: (state: ParserState) => {
    const s = geminiState(state);
    return {
      runningTurns: s.runningTurns,
      runningSessionId: s.runningSessionId,
      runningModel: s.runningModel,
      lastAssistantText: s.lastAssistantText,
      sawErrorEvent: s.sawErrorEvent,
    };
  },
};
