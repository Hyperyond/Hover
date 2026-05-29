# Agent registry

Hover doesn't bundle an AI runtime. Each supported coding-agent CLI is a single `AgentDescriptor` entry in [`packages/core/src/agents/registry.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/core/src/agents/registry.ts).

## Supported agents

| Agent | Sandbox | Status | Notes |
|---|---|---|---|
| `claude` | hard | ✅ shipped | Claude Code. `--strict-mcp-config` + `--allowedTools mcp__playwright` + per-tool `--disallowedTools` deny list. Honours `--max-budget-usd`. Stream-json on stdout. |
| `codex` | soft | ✅ shipped | OpenAI Codex CLI. `--sandbox read-only` + a strict `developer_instructions` system prompt — codex has no CLI-level built-in-tool deny list. JSONL on stdout. ⚠ in the dropdown. |
| `cursor-agent` | soft | ✅ shipped (v0.9) | Cursor CLI. Install hint: `curl https://cursor.com/install -fsS \| bash`. Stream-JSON / NDJSON parser handles Cursor's `system / user / assistant / tool_call / result` event shapes. Known limits: no `--max-budget-usd`, no `--mcp-config` (users add the Playwright MCP to `~/.cursor/mcp.json` themselves), no token / cost in the stream (widget renders `–` for cursor sessions). ⚠ in the dropdown. |

## The `AgentDescriptor` interface

```ts
interface AgentDescriptor {
  id: string;                                   // e.g. 'claude', 'codex', 'cursor-agent'
  binName: string;                              // executable name on PATH
  protocol: 'argv' | 'stdin' | 'acp' | 'pi-rpc';
  streamFormat: 'stream-json' | 'sse' | 'plain-text' | 'json-lines';
  sandboxStrength: 'hard' | 'soft';
  display: AgentDisplay;                        // label, tagline, homepage, installHint
  buildArgs(opts: InvokeOptions): string[];
  parseEvent(line: string, state?: ParserState): InvokeEvent[];
  onStreamEnd?(exitCode: number | null, state?: ParserState): InvokeEvent | null;
}
```

To add a new agent: write a new descriptor file (e.g. `aider.ts`), import it in `registry.ts`, append to the `AGENTS` constant. Nothing else changes.

## Sandbox strength

- **`hard`** — the agent CLI accepts a deny / allow list that effectively removes built-in tools (shell, file edit, …) so the only callable surface is whatever MCP servers Hover configures. Example: Claude Code's `--strict-mcp-config --allowedTools mcp__playwright --disallowedTools "Bash Edit Write Read …"`.
- **`soft`** — no equivalent flag exists. Hover constrains side-effects via OS-level sandbox flags (e.g. Codex's `--sandbox read-only`) and leans on a strict `developer_instructions` system prompt to nudge the agent toward MCP-only behavior. A determined / hallucinating agent *could* still try a built-in shell call.

The widget marks soft-sandbox agents with a ⚠ badge.

## Adding a new agent

Pick the closest existing peer as a template:

- **Hard-sandbox CLI** (has an allow/deny tool list) — copy `claude.ts`.
- **Soft-sandbox CLI** with `developer_instructions`-style system prompt support — copy `codex.ts`.
- **Soft-sandbox CLI** with workspace-file rule injection only — copy `cursor.ts`.

Write the descriptor under `packages/core/src/agents/`, import it in `registry.ts`, append to the `AGENTS` constant. The detect / argv / invoke / service / widget chain picks it up automatically — no other changes. PRs welcome.
