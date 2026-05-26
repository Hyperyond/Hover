# Agent registry

Hover doesn't bundle an AI runtime. Each supported coding-agent CLI is a single `AgentDescriptor` entry in [`packages/core/src/agents/registry.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/core/src/agents/registry.ts).

## The `AgentDescriptor` interface

```ts
interface AgentDescriptor {
  id: string;                                   // e.g. 'claude', 'codex'
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

To add a new agent: write a new descriptor file (e.g. `cursor.ts`), import it in `registry.ts`, append to the `AGENTS` constant. Nothing else changes.

## Sandbox strength

- **`hard`** — the agent CLI accepts a deny / allow list that effectively removes built-in tools (shell, file edit, …) so the only callable surface is whatever MCP servers Hover configures. Example: Claude Code's `--strict-mcp-config --allowedTools mcp__playwright --disallowedTools "Bash Edit Write Read …"`.
- **`soft`** — no equivalent flag exists. Hover constrains side-effects via OS-level sandbox flags (e.g. Codex's `--sandbox read-only`) and leans on a strict `developer_instructions` system prompt to nudge the agent toward MCP-only behavior. A determined / hallucinating agent *could* still try a built-in shell call.

The widget marks soft-sandbox agents with a ⚠ badge.

::: info This page is a placeholder
Full content coming soon — concrete walkthrough of adding `aider`, `cursor-agent`, or `gemini-cli`.
:::
