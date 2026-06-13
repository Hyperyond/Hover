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

### Seed library — extending translation (`.hover/rules/`)

The optimization pass generalizes from **seeds**: human-written worked examples
of "captured steps → the Playwright code they should produce." This is how
coverage of new multi-step patterns grows **without core changes** — you (or the
community) drop a JSON file; the pass picks it up as few-shot.

A seed lives at `<projectRoot>/.hover/rules/<name>.json` and matches
[`src/specs/seed.schema.json`](src/specs/seed.schema.json):

```json
{
  "name": "oauth-popup",
  "signature": ["browser_click", "browser_tabs:select"],
  "note": "sign in through a provider popup that opens a new tab",
  "example": {
    "steps": [
      { "tool": "browser_click", "element": "Sign in with Google button" },
      { "tool": "browser_tabs", "action": "select", "idx": 1 }
    ],
    "code": "const [popup] = await Promise.all([\n  context.waitForEvent('page'),\n  page.getByRole('button', { name: 'Sign in with Google' }).click(),\n]);\nawait popup.getByLabel('Email').fill('user@example.com');"
  }
}
```

- **`signature`** is a cheap relevance filter only — `relevantSeeds()` keeps a
  seed if any of its base tools (`browser_tabs:select` → `browser_tabs`) appears
  in the spec being optimized. It is **not** exact-matched.
- **`code`** must obey the same rules as generated specs: semantic selectors, no
  XPath, no `waitForTimeout`.
- **Built-in seeds** are JSON files in this package's
  [`seeds/optimization/`](seeds/optimization/) directory — the full catalogue
  ships with Hover (`download`, `file-upload`, `dialog`,
  `network-gated-assertion`, `oauth-popup`), loaded synchronously at module init
  into `BUILTIN_SEEDS`. Adding a built-in = dropping a JSON there (no code
  change); `readSeeds(projectRoot)` returns those plus your `.hover/rules/*.json`
  (malformed files skipped, not fatal). Semantic / judgement-based optimizations
  (e.g. *which* feedback text to assert) are not seeds — they're standing
  instructions in the prompt.
- **Suppressing a built-in:** list its `name` under `disabled` in
  `<projectRoot>/.hover/seeds.json` — e.g. `{ "disabled": ["oauth-popup"] }` —
  and `readSeeds` filters it out.

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
- `--allowedTools mcp__playwright` — only Playwright MCP is callable
- `--disallowedTools Bash Edit Write Read Grep Glob Task WebFetch WebSearch EnterWorktree CronCreate …` — every built-in tool explicitly denied (full list in `CLAUDE_DEFAULT_DISALLOWED_TOOLS` in `claude.ts`)
- `--permission-mode dontAsk` — anything not whitelisted aborts the run
- `--max-budget-usd <n>` — optional hard $ ceiling per session (no default; pass `maxBudgetUsd` in plugin options or via the CLI flag to enable)

Together these enforce the rule that the spawned agent can only reach the browser via Playwright MCP — never the host filesystem, shell, or network. A hijacked prompt or hallucinated destructive action has nowhere to land.
