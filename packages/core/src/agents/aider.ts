import type { AgentDescriptor, InvokeOptions, InvokeEvent, ParserState } from './types.js';
import { HOVER_PROMPT_PREFACE } from './shared.js';

/**
 * Aider CLI descriptor (`aider`, https://aider.chat).
 *
 * Wire shape: `aider --message "<prompt>" --no-stream --yes-always` runs the
 * agent in one-shot mode and streams **plain text** to stdout. There is NO
 * structured JSON / JSONL / SSE output mode — aider only knows how to print
 * human-readable progress lines and the LLM's final text reply. Source:
 * https://aider.chat/docs/scripting.html (verified 2026-05).
 *
 * This means aider is a strictly degraded experience inside Hover compared to
 * claude / codex / cursor / qwen / gemini:
 *
 *   - We cannot extract individual tool_use / tool_result events. We surface
 *     every non-empty stdout line as an `ai_text` event so the user sees
 *     SOMETHING in the panel. No per-tool icons, no live cost chip.
 *   - aider has no `--output-format json` even on `main`. Adding a parser for
 *     its ad-hoc progress lines (`Tokens: 1.2k sent, 0.3k received`, etc.)
 *     would be a moving target — the strings aren't a stable API.
 *   - aider has no MCP server support as of 2026-05. Its tool model is
 *     hard-wired to "read these files / edit those files / run shell" via
 *     the chat UI. There is no per-invocation `--mcp-config` flag and the
 *     project has not announced MCP integration upstream
 *     (https://aider.chat/docs/ — no MCP reference). For Hover this is a
 *     **fundamental mismatch**: the whole pipeline assumes the agent drives
 *     the browser via the Playwright MCP server. If a user picks aider from
 *     the widget dropdown, the agent will simply respond in chat without
 *     ever touching the browser. We still register it so the user has the
 *     option, and the widget marks it with the same soft-sandbox ⚠ badge
 *     as codex / cursor, but it is best understood as "chat-with-LLM mode"
 *     not "drive-the-browser mode" until upstream lands MCP support.
 *   - aider has no `--append-system-prompt` flag and no JSON output mode for
 *     us to inject session-specific guidance, so the HOVER-mode preface is
 *     prepended to the user prompt (same pattern as cursor.ts). The agent
 *     reads it as the leading user-message text — closest available
 *     functional analogue.
 *   - No session resumption flag matching cursor's `--resume <chat_id>` or
 *     codex's `exec resume <id>`. Aider's chat history is repo-local
 *     (`.aider.chat.history.md`) and uses `--restore-chat-history` (a
 *     boolean) to reload it; there's no way to pick a specific past session
 *     by ID. We omit the session-resumption path entirely; `opts.sessionId`
 *     is ignored.
 *   - No `--max-budget-usd`. Same omission as codex / cursor.
 *
 * Important: aider's default behaviour is to AUTO-COMMIT every edit it makes
 * via git. For a browser-driving agent that should never edit files, this is
 * still a hazard if the user has a stale git repo open in cwd. We pass
 * `--no-auto-commits --no-git` to defang the git side-effects. `--no-stream`
 * makes stdout line-buffered (closer to one-event-per-line) instead of
 * character-streamed, which is friendlier for our per-line parseEvent loop.
 */

interface AiderParserState extends ParserState {
  runningLines: number;
  collectedText: string[];
  sawErrorEvent: boolean;
  /** Stable synthetic session id we generate at first parseEvent so the
   *  widget sees a session_start. Aider doesn't emit one. */
  runningSessionId: string | undefined;
}

function aiderState(state: ParserState): AiderParserState {
  if (typeof state.runningLines !== 'number') {
    state.runningLines = 0;
    state.collectedText = [];
    state.sawErrorEvent = false;
    state.runningSessionId = undefined;
  }
  return state as AiderParserState;
}

function resetAiderCounters(s: AiderParserState): void {
  s.runningLines = 0;
  s.collectedText = [];
  s.sawErrorEvent = false;
  s.runningSessionId = undefined;
}

// Aider has no system-prompt flag, so we prepend the standing HOVER-mode
// preface (HOVER_PROMPT_PREFACE, from shared.ts) to the user prompt (same
// approach as cursor.ts). The agent treats it as the leading user-message text.

/**
 * Lines we treat as noise and drop instead of surfacing as text events.
 * Aider chatters with status lines that would clutter the widget panel.
 * Conservative list — anything we don't explicitly skip falls through.
 */
function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // Common aider boilerplate / banner lines.
  if (/^Aider v\d/i.test(t)) return true;
  if (/^Main model:/i.test(t)) return true;
  if (/^Weak model:/i.test(t)) return true;
  if (/^Git repo:/i.test(t)) return true;
  if (/^Repo-map:/i.test(t)) return true;
  if (/^VSCode terminal detected/i.test(t)) return true;
  if (/^Use \/help/i.test(t)) return true;
  if (/^Tokens:.*sent.*received/i.test(t)) return true;
  if (/^─{3,}$/.test(t)) return true; // horizontal rule
  return false;
}

function detectErrorLine(line: string): boolean {
  // Aider prints errors / API failures with a leading marker.
  return /^(error|fatal|api error|litellm.*error)/i.test(line.trim());
}

export const aiderAgent: AgentDescriptor = {
  id: 'aider',
  binName: 'aider',
  protocol: 'argv',
  streamFormat: 'plain-text',
  sandboxStrength: 'soft',
  display: {
    label: 'Aider',
    tagline: 'Aider — soft sandbox, plain-text stream, no MCP support',
    homepage: 'https://aider.chat',
    installHint: 'pipx install aider-chat',
  },

  buildArgs(opts: InvokeOptions): string[] {
    // Prepend HOVER-mode preface plus any caller-supplied appendSystemPrompt
    // to the prompt. Aider has no --append-system-prompt flag, so this is
    // the closest functional analogue (same trick as cursor.ts).
    const preface = opts.appendSystemPrompt && opts.appendSystemPrompt.trim().length > 0
      ? `${HOVER_PROMPT_PREFACE} ${opts.appendSystemPrompt}`
      : HOVER_PROMPT_PREFACE;
    const finalPrompt = `${preface}\n\n${opts.prompt}`;

    const args: string[] = ['--message', finalPrompt];

    // Auto-confirm every prompt so the run doesn't hang.
    args.push('--yes-always');

    // Make stdout line-buffered instead of character-streamed; friendlier
    // for our per-line parseEvent loop.
    args.push('--no-stream');

    // Defang git side-effects. Aider's default behaviour is to auto-commit
    // every edit it makes; for a browser-driving agent that should never
    // edit files this is still a hazard if cwd is a stale repo.
    args.push('--no-auto-commits');
    args.push('--no-git');

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Aider's `--restore-chat-history` is a boolean (no session-id form);
    // we deliberately do NOT pass it. `opts.sessionId` is ignored because
    // there is no way to select a specific past session by ID.

    // No equivalents for --max-budget-usd / --allowedTools / --mcp-config /
    // --append-system-prompt — all four are absent from aider.

    return args;
  },

  parseEvent(line: string, state: ParserState = {}): InvokeEvent[] {
    const s = aiderState(state);
    const out: InvokeEvent[] = [];

    // Emit a synthetic session_start on the very first non-empty line so
    // the widget gets the same shape it expects from JSON-based agents.
    if (!s.runningSessionId) {
      // Cheap unique id; aider has no real session_id we can echo. The
      // Math.random() suffix is load-bearing — two states created in the
      // same millisecond would otherwise collide and break per-invocation
      // session tracking.
      const rand = Math.random().toString(36).slice(2, 8);
      s.runningSessionId = `aider-${Date.now().toString(36)}-${rand}`;
      out.push({ kind: 'session_start', sessionId: s.runningSessionId });
    }

    if (isNoiseLine(line)) return out;

    if (detectErrorLine(line)) {
      s.sawErrorEvent = true;
      out.push({ kind: 'text', text: line.trim() });
      return out;
    }

    // Treat everything else as assistant text. Aider has no per-tool events
    // so we cannot emit tool_use / tool_result — see file-header doc comment.
    s.runningLines += 1;
    s.collectedText.push(line.trim());
    out.push({ kind: 'text', text: line.trim() });

    return out;
  },

  /**
   * Aider doesn't emit a terminal event — the child process simply exits
   * after the final printed line. Synthesize session_end from accumulated
   * state, same pattern as codex.ts.
   */
  onStreamEnd(exitCode: number | null, state: ParserState = {}): InvokeEvent {
    const s = aiderState(state);
    // The "summary" is the last non-empty text line, which is typically
    // aider's final answer. If we collected nothing, leave it undefined
    // rather than fabricating.
    const lastText = s.collectedText.length > 0
      ? s.collectedText[s.collectedText.length - 1]
      : undefined;
    return {
      kind: 'session_end',
      turns: s.runningLines,
      // costUsd intentionally undefined — aider's "Tokens:" status line is
      // ad-hoc text, not a stable API. We don't fabricate a number.
      isError: s.sawErrorEvent || (exitCode != null && exitCode !== 0),
      summary: lastText,
    };
  },
};

/**
 * Test-only escape hatches, same pattern as cursor.ts / codex.ts.
 */
export const __testing = {
  freshState: (): ParserState => ({}),
  resetCounters: (state: ParserState) => resetAiderCounters(aiderState(state)),
  getState: (state: ParserState) => {
    const s = aiderState(state);
    return {
      runningLines: s.runningLines,
      runningSessionId: s.runningSessionId,
      collectedText: [...s.collectedText],
      sawErrorEvent: s.sawErrorEvent,
    };
  },
};
