/**
 * Cross-agent helpers shared by the soft-sandbox descriptors
 * (codex / cursor / gemini / qwen / aider).
 *
 * These agents all need the same two things:
 *   1. A standing "HOVER-mode" instruction preface that tells the agent to
 *      drive the browser via the Playwright MCP tools only and not to touch
 *      its built-in shell / file-edit tools. Each agent injects it through a
 *      different channel (cursor / gemini / aider prepend it to the prompt,
 *      qwen passes it via --append-system-prompt, codex via
 *      `-c developer_instructions=`), so this module owns only the *text*, not
 *      the injection.
 *   2. Normalising the `mcp__playwright__` / `mcp__hover-playwright__` prefix
 *      off a raw tool name so the emitted tool names line up across agents.
 *
 * codex deliberately does NOT use HOVER_PROMPT_PREFACE — it keeps its own
 * wording ("Do NOT call …", "emit a short agent_message summary …") that is
 * tuned to codex's event vocabulary. See codex.ts.
 */

/**
 * The standing HOVER-mode instruction shared by cursor / gemini / qwen / aider.
 * codex carries a near-identical but intentionally different variant inline.
 */
export const HOVER_PROMPT_PREFACE = [
  'You are operating in Hover, a browser-testing tool.',
  'Use ONLY the MCP playwright tools (prefixed `mcp__playwright__` / `mcp__hover-playwright__`) to drive the browser.',
  'Do NOT use shell, file-edit, web-search, or any other built-in tool.',
  'Do NOT navigate to a URL the user is already on; check the page state via `browser_snapshot` first.',
  'When the task is complete, emit a short summary and stop.',
].join(' ');

/** Strip the `mcp__playwright__` / `mcp__hover-playwright__` prefix so tool
 *  names match the normalised names every agent emits. */
export function stripMcpPrefix(raw: string): string {
  return raw.replace(/^mcp__playwright__/, '').replace(/^mcp__hover-playwright__/, '');
}
