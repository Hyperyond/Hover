# @hover-dev/core

The local Node service. Owns:

- **Agent invocation** (`src/agents/`) — Local CLI Agent First. Spawns `claude` / `codex` / `cursor-agent` / `aider` / `gemini-cli` / `qwen-code` and normalizes their output into a single `InvokeEvent` stream.
- **Playwright preflight** (`src/playwright/`) — verifies CDP connection to the user's Chrome.

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

## Spec generation (specs/)

A verified session crystallizes into a standard `@playwright/test` file under
`<devRoot>/__vibe_tests__/`. Translation is **deterministic — no LLM on the
per-save path** (reproducible by construction):

- `writeSpec.ts` walks the captured `browser_*` actions and emits one Playwright
  call each (`getByRole` / `getByLabel` / `getByText` selectors — never XPath).
  A few high-frequency multi-action shapes are hardcoded (popup / new-tab →
  `Promise.all([context.waitForEvent('page'), …click()])`). An action with no
  single-step translation (file upload, drag, …) leaves a structured
  `// hover:optimizable: <tool>` marker rather than a `// TODO` — the draft stays
  runnable around it. `countOptimizableMarkers()` reads the count back; `listSpecs`
  surfaces it as `SpecSummary.optimizableCount`.
- Alongside the `.spec.ts`, a **sidecar** is written to
  `.hover/sidecars/<slug>.json` — the structured `SpecStep[]` + observed signals. This is
  the machine-readable behavior record the optimization pass reads (it keeps the
  spec itself clean).

### Optional optimization pass (F7)

The **service** (never the sandboxed browser agent) can optionally run an LLM
**codegen** call over a draft to polish it — chiefly to add assertions for the
feedback the session observed. Its input is data the service already holds (the
draft + sidecar + relevant seeds), not live page content, so it sits outside the
agent's prompt-injection surface and needs no filesystem access. It writes an
**optimization candidate** to `.hover/cache/optimized/<slug>.spec.ts.draft` (never
`*.spec.ts`, so the test runner can't collect an unreviewed candidate). A human
promotes or discards it via diff — **the deterministic original is always
preserved**. Off by default.

### Seed library — translation patterns (`BUILTIN_SEEDS`)

The optimization pass generalizes from **seeds**: worked examples of "captured
steps → the Playwright code they should produce", fed to the pass as few-shot.
They ship inlined as the `BUILTIN_SEEDS` constant in
[`src/specs/seeds.ts`](src/specs/seeds.ts) (`download`, `file-upload`, `dialog`,
`network-gated-assertion`, `oauth-popup`); a seed is a `signature` (tool names)
+ a concrete `example` (`steps` → `code`):

```ts
{
  name: 'oauth-popup',
  signature: ['browser_click', 'browser_tabs:select'],
  note: 'sign in through a provider popup that opens a new tab',
  example: {
    steps: [
      { tool: 'browser_click', element: 'Sign in with Google button' },
      { tool: 'browser_tabs', action: 'select', idx: 1 },
    ],
    code: `const [popup] = await Promise.all([ ... ]);`,
  },
}
```

- **`signature`** is a cheap relevance filter only — `relevantSeeds()` keeps a
  seed if any of its base tools (`browser_tabs:select` → `browser_tabs`) appears
  in the spec being optimized. It is **not** exact-matched.
- **`code`** must obey the same rules as generated specs: semantic selectors, no
  XPath, no `waitForTimeout`.
- Adding a pattern = appending a `SeedRule` to `BUILTIN_SEEDS`. There is no
  user-authored-seed file mechanism: the catalogue is curated and ships with
  Hover. Semantic / judgement-based optimizations (e.g. *which* feedback text to
  assert) are not seeds — they're standing instructions in the prompt.

## Exercising the engine

There is no standalone CLI smoke loop — the engine is driven by the VS Code extension. Build + sideload it (`pnpm --filter hover-dev package`), open the Hover chat, and drive any dev server. The extension spawns the isolated debug Chrome on demand and connects to the engine over WS (ports 51789+). Env knobs the engine reads: `HOVER_CDP` (CDP URL, default `http://localhost:9222`), `HOVER_AGENT` (agent id; omit to auto-detect), `HOVER_MODEL` (default `sonnet`).

## Sandboxing

The `claude -p` invocation is locked down so Claude can only drive the browser:

- `--strict-mcp-config` — ignore any MCP servers in `~/.claude/` or `.mcp.json`
- `--allowedTools mcp__playwright` — only Playwright MCP is callable
- `--disallowedTools Bash Edit Write Read Grep Glob Task WebFetch WebSearch EnterWorktree CronCreate …` — every built-in tool explicitly denied (full list in `CLAUDE_DEFAULT_DISALLOWED_TOOLS` in `claude.ts`)
- `--permission-mode dontAsk` — anything not whitelisted aborts the run
- `--max-budget-usd <n>` — optional hard $ ceiling per session (no default; pass `maxBudgetUsd` in plugin options or via the CLI flag to enable)

Together these enforce the rule that the spawned agent can only reach the browser via Playwright MCP — never the host filesystem, shell, or network. A hijacked prompt or hallucinated destructive action has nowhere to land.
