# @hover-dev/core

The local Node service. Owns:

- **Agent invocation** (`src/agents/`) — Local CLI Agent First. Spawns `claude` / `codex` / `cursor-agent` / `aider` / `gemini-cli` / `qwen-code` and normalizes their output into a single `InvokeEvent` stream.
- **Playwright preflight** (`src/playwright/`) — verifies CDP connection to the user's Chrome.
- **Smoke test** (`src/smoke.ts`) — end-to-end verification of the whole chain.

## Architecture (agents/)

"Local CLI Agent First" — Hover bundles no AI runtime. It spawns whichever coding-agent CLI is on the user's `PATH` and normalizes its output to a single event stream:

| File | Purpose |
|---|---|
| `types.ts` | `AgentDescriptor`, `InvokeOptions`, `InvokeEvent`, protocol/format enums, error classes |
| `registry.ts` | `AGENTS` constant — single source of truth for supported agents |
| `detect.ts` | `detectAgents()`, `resolveBinForAgent()`, `resolveOnPath()` — PATH scanning |
| `argv.ts` | `buildArgv()` — protocol-aware argv construction, throws `UnsupportedAgentProtocolError` for `acp` / `pi-rpc` |
| `invoke.ts` | `invokeAgent()` — async-iterable spawning + stdout streaming |
| `claude.ts` | Claude Code descriptor: `claude -p`, stream-json parser, hard sandbox flags |
| `codex.ts` | OpenAI Codex CLI descriptor: `codex exec --json`, JSONL parser, soft sandbox (`--sandbox read-only`) |
| `cursor.ts` | Cursor CLI descriptor (v0.9): stream-JSON / NDJSON parser, soft sandbox |
| `aider.ts` | Aider CLI descriptor (v0.10): JSON-stream parser, soft sandbox |
| `gemini.ts` | Gemini CLI descriptor (v0.10): stream parser, soft sandbox |
| `qwen.ts` | Qwen Code descriptor (v0.10): stream parser, soft sandbox |

To add an agent: implement an `AgentDescriptor`, register it in `registry.ts`. Done.

## Smoke test

```bash
# Terminal 1: run basic-app — also spawns a debug Chrome (the example sets
# `autoLaunchChrome: true`) navigated to http://localhost:5173
pnpm dev:example:basic-app   # from repo root

# Terminal 2: run the smoke test
pnpm smoke                   # from repo root, defaults to http://localhost:5173
```

Need the debug Chrome standalone (no example)? `pnpm smoke:chrome` (or `pnpm exec hover-chrome`).

Override the target or prompt:

```bash
pnpm smoke http://localhost:5173/ "log in then add a todo named 'verify hover'"
```

Environment variables:

- `HOVER_CDP` — CDP URL (default `http://localhost:9222`)
- `HOVER_AGENT` — agent id (omit to auto-detect; tries the user's stated preference, then the first installed agent in registry order — `claude` → `codex` → `cursor-agent` → `aider` → `gemini-cli` → `qwen-code` today)
- `HOVER_MODEL` — model for the agent (default `sonnet`, much cheaper than opus)

## Sandboxing (what the smoke test enforces)

The `claude -p` invocation is locked down so Claude can only drive the browser:

- `--strict-mcp-config` — ignore any MCP servers in `~/.claude/` or `.mcp.json`
- `--allowedTools mcp__playwright Skill` — only Playwright MCP and the Skill tool are callable
- `--disallowedTools Bash Edit Write Read Grep Glob Task WebFetch WebSearch EnterWorktree CronCreate …` — every built-in tool explicitly denied (full list in `CLAUDE_DEFAULT_DISALLOWED_TOOLS` in `claude.ts`)
- `--permission-mode dontAsk` — anything not whitelisted aborts the run
- `--max-budget-usd <n>` — optional hard $ ceiling per session (no default; pass `maxBudgetUsd` in plugin options or via the CLI flag to enable)

Together these enforce the rule that the spawned agent can only reach the browser via Playwright MCP — never the host filesystem, shell, or network. A hijacked prompt or hallucinated destructive action has nowhere to land.
