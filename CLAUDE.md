# Directory guide

This file is the single source of truth for agents entering the Hover repository. Read this file first. It describes the current implementation and the boundaries agents must respect when working in it.

## Core documentation index

- Product scope and onboarding: `README.md`.
- Architecture and protocols: this file (`CLAUDE.md`), `packages/core/README.md`.
- License: `LICENSE` (Apache-2.0).

## What Hover is

Hover is a Vite plugin (later: a Chrome extension) that injects a floating chat widget into the user's dev server page. The developer types natural-language instructions ("test the login flow"), an agent drives their *actual* Chrome via CDP + Playwright MCP, and the verified session can be one-click crystallized into a standard Playwright `.spec.ts` file under `__vibe_tests__/`.

The differentiator vs. Stagehand / Midscene / Playwright codegen is the **AI exploration → deterministic script** workflow: AI authors the test, but the saved artifact is plain `@playwright/test` code that runs in CI without an agent in the loop.

## Workspace directories

Workspace packages come from `pnpm-workspace.yaml`: `packages/*` and `examples/*`. The repo is pnpm + ESM throughout.

- `packages/core` is `@hover/core` — the Node service. Owns agent invocation, Playwright CDP preflight, MCP config, and the WebSocket bridge between the injected UI and the agent process.
- `packages/vite-plugin` is `@hover/vite-plugin` — the Vite plugin that injects the floating chat widget into the user's dev server page. Must be a no-op in production builds (`apply: 'serve'`).
- `examples/example-frontend` is a Vite + React app used as the target for smoke tests.

## Inactive or placeholder directories

- `__vibe_tests__/` is the write target for crystallized Playwright specs. The directory is created by the runtime; do not hand-author placeholder files there.

## Repository status

Phase 0 (end-to-end feasibility) is verified — a `claude -p` invocation, sandboxed to only the Playwright MCP server, successfully drives the user's Chrome through a multi-step task in `examples/example-frontend`. Phase 1 (Vite plugin + chat UI + persistent Node service) is the active work.

Development order is Phase 0 → 1 → 2 → 3. Phase 1 work order: WebSocket server in `@hover/core` → real Vite plugin injection (`transformIndexHtml` + Shadow DOM widget) → "save as Playwright spec" file emission.

# Architecture

## Local CLI Agent First

Hover bundles no AI runtime. It spawns whatever coding-agent CLI the user already has on PATH (`claude`, `codex`, `cursor`, `aider`, ...) and normalizes its output into a single event stream.

Five files in `packages/core/src/agents/`:

| File | Purpose |
|---|---|
| `types.ts` | `AgentDescriptor`, `InvokeOptions`, normalized `InvokeEvent`, protocol/format enums, error classes |
| `registry.ts` | `AGENTS` constant — single source of truth for supported agents |
| `detect.ts` | `detectAgents()`, `resolveBinForAgent()`, `resolveOnPath()` — PATH scanning |
| `argv.ts` | `buildArgv()` — protocol-aware argv construction |
| `invoke.ts` | `invokeAgent()` — async-iterable: spawn child, parse stream, yield normalized events |

Per-agent strategy lives in its own file (currently just `claude.ts`). To add a new agent: write its `AgentDescriptor` and register it in `registry.ts` — nothing else changes.

The full flow for one command: page UI → WebSocket → `@hover/core` → spawn agent → MCP → Playwright → CDP → user's Chrome. Step events flow back the same path in reverse.

## Boundary constraints

These are load-bearing — several are non-obvious:

- Connect to the user's Chrome, never launch a new one. Use `connectOverCDP` and pick the existing context/page whose URL matches the dev-server origin.
- Strict sandboxing. The smoke test passes `--strict-mcp-config`, `--permission-mode dontAsk`, `--allowedTools mcp__playwright`, `--disallowedTools "Bash Edit Write Read Grep Glob Task WebFetch WebSearch"`, and `--max-budget-usd 0.50`. The Playwright MCP server is the only tool Claude can reach. Filesystem access (other than the eventual `__vibe_tests__/` write path) is forbidden.
- Default model is `sonnet`, not `opus`. Opus is ~5× more expensive per browser-driving session. Override with `HOVER_MODEL=opus` if needed for harder tasks.
- The injected UI lives in a Shadow DOM and marks itself with `data-vibe-test="true"` so Playwright can skip it. Tailwind's default scan does not work inside Shadow DOM — use inline styles or CSS-in-JS.
- The local Node service binds to `127.0.0.1` only. The Vite plugin must be a no-op in production builds (`apply: 'serve'` in `@hover/vite-plugin`).
- Generated Playwright code prefers `page.getByRole` / `page.getByText` over CSS/XPath selectors.
- Cookies / localStorage never transit the Node service; auth state stays inside the browser and is handled by Playwright in-process.
- Child-process stdio must be drained, or the spawned agent deadlocks.
- WebSocket reconnect must be robust because Vite HMR will tear down the page repeatedly during normal dev.
- Output is standard `@playwright/test` files. No proprietary test format.

## Billing risk (active)

Starting **2026-06-15**, `claude -p` calls draw from a new monthly Agent SDK credit pool separate from interactive limits. Pro: $20, Max 5x: $100, Max 20x: $200. Overage flows to API rates if usage credits are enabled, otherwise hard cutoff until refresh. Two mitigations are already in place:

1. `--max-budget-usd` ceiling per invocation (currently $0.50 in `smoke.ts`).
2. Local CLI Agent First — adding `codex`, `cursor-agent`, etc. is a one-file change, so users can switch agents if `claude` becomes expensive for them.

# Development workflow

## Environment baseline

- Runtime is Node 24+, pnpm 10+. The repo is ESM throughout. No CJS at the source layer.
- `tsconfig.base.json` at the root is the shared TS config every package extends. There is no root `tsconfig.json` — typecheck runs per-package via `pnpm typecheck`.
- Test stack: Vitest for unit tests (per-package, under `packages/*/tests/`), Playwright dogfooding for integration (crystallized specs under `examples/example-frontend/__vibe_tests__/`). No linter or formatter is configured yet.

## Local lifecycle

Three terminals on first run; once Chrome and Vite are up they stay running across many smoke loops:

1. `pnpm smoke:chrome` — launches a debug-mode Chrome (`--remote-debugging-port=9222`, isolated profile at `/tmp/hover-smoke`).
2. `pnpm dev:example` — example-frontend at http://localhost:5173.
3. `pnpm smoke` — end-to-end: detect agents → CDP preflight → invoke `claude` → stream events.

Custom target / prompt:

```bash
pnpm smoke http://localhost:5173/ "log in, then add a todo named 'verify hover'"
```

Environment overrides:

```bash
HOVER_AGENT=claude HOVER_MODEL=sonnet HOVER_CDP=http://localhost:9222 pnpm smoke
```

## Git commit policy

- Use Conventional Commits. Format: `<type>(<scope>): <description>`.
- Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`.
- `<scope>` is the package or sub-area: `core`, `vite-plugin`, `example`, `agents`, `playwright`, `mcp`, `ci`, `deps`.
- Commit messages are written in **English**. Hover is a public open-source repo; contributors come from everywhere.
- The subject line is imperative, ≤72 characters, no trailing period.
- Conventional Commits is enforced at commit time by a husky `commit-msg` hook running `commitlint`. The hook installs on `pnpm install`. Do not bypass it with `--no-verify` unless you have explicit owner sign-off.
- Stage files explicitly by name. Do not use `git add -A` / `git add .` — this avoids accidentally committing secrets or large binaries.
- Never amend a previous commit unless explicitly requested. Create a new commit instead.
- Never force-push to `main`. Never skip hooks. Never modify git config.

## Branching policy

- `main` must stay runnable. Every commit pushed to `main` should, in theory, leave the basic flow (`pnpm install` → `pnpm typecheck` → `pnpm smoke`) intact. This is what makes `git bisect` meaningful.
- Speculative or exploratory work goes on a branch: `git checkout -b experiment/<name>` (e.g. `experiment/chrome-extension`). Commit messily; if it works merge to `main`, if not delete the branch.
- Feature work: `feat/<name>`. Bug fixes: `fix/<name>`.

## Milestone tags

Tag versions at meaningful milestones so the history has anchor points:

- `v0.0.1-poc` — Phase 0 (end-to-end feasibility) verified.
- `v0.1.0` — Phase 1 (Vite plugin + chat UI + persistent service) shipped.

## Test strategy

- Unit tests: **Vitest**, per-package, in `packages/*/tests/` sibling to `src/`. Run with `pnpm --filter @hover/core test` or `pnpm test` at the root (which fans out across the workspace). Keep `src/` source-only; do not place `*.test.ts` inside `src/`. Current coverage: `packages/core/tests/agents/` (argv dispatcher, claude descriptor, registry).
- Integration / e2e: **Playwright dogfooding**. Crystallized specs land under `examples/example-frontend/__vibe_tests__/` and run with standard `@playwright/test`. The agent must not be involved at CI time — only the Playwright script runs. Bootstrap on a fresh machine: `pnpm --filter example-frontend exec playwright install chromium`. Run with `pnpm test:e2e`.
- Smoke-level end-to-end (agent in the loop): `pnpm smoke`. This requires a running debug Chrome and the example frontend; it is not part of CI.

## Validation strategy

Before marking work ready:

1. `pnpm typecheck` — fans out to every package.
2. `pnpm test` — Vitest, fans out across packages with tests.
3. The package-scoped smoke or Playwright run that matches the files changed.

# Common commands

```bash
pnpm install              # workspace install (also runs husky install via the `prepare` script)
pnpm typecheck            # tsc --noEmit, per-package
pnpm test                 # vitest, per-package (where present)
pnpm test:e2e             # Playwright dogfood suite — first run needs `playwright install chromium`
pnpm dev:example          # start example-frontend at http://localhost:5173
pnpm smoke:chrome         # launch debug-mode Chrome (--remote-debugging-port=9222)
pnpm smoke                # end-to-end: detect agents → CDP preflight → invoke claude
pnpm detect               # list installed coding agents
pnpm verify-widget        # validate that the injected widget reports `data-vibe-test`
pnpm ws-smoke             # exercise the @hover/core WebSocket bridge in isolation
```

```bash
pnpm --filter @hover/core test
pnpm --filter @hover/core typecheck
pnpm --filter @hover/vite-plugin typecheck
pnpm --filter example-frontend dev
```

# FAQ

## Why is the default model `sonnet` and not `opus`?

A typical browser-driving session with `opus` costs ~5× the equivalent `sonnet` session. Hover is meant to run continuously during dev; default to `sonnet`. Set `HOVER_MODEL=opus` per-invocation when you need it.

## Why does Hover never launch its own Chrome?

The user is logged into their dev env, has dev-tools state, has cookies, has the page in the state they were debugging. Launching a fresh Chrome throws all of that away. Hover connects to an existing Chrome over CDP (`connectOverCDP`) and picks the tab whose URL matches the dev-server origin.

## Why is filesystem access disallowed on the agent?

The agent only needs the Playwright MCP server — that is enough to drive the browser end-to-end. Allowing `Bash`, `Edit`, `Write`, `Read`, etc. dramatically widens the blast radius if the prompt is hijacked or if the agent hallucinates a destructive action. The single write path (eventually under `__vibe_tests__/`) is granted by the Node service, not by the agent's tool list.

## Why is the UI in a Shadow DOM?

Two reasons: (1) style isolation from the host app, so Hover's CSS does not bleed into the page under test, and (2) Playwright tests must be able to skip Hover's own DOM — the `data-vibe-test="true"` marker on the Shadow root makes the filter trivial. Tailwind's content scanner does not see inside Shadow DOM; use inline styles or CSS-in-JS.

## Why `--max-budget-usd 0.50`?

A safety belt against runaway prompts. Phase 0 sessions empirically complete a 5-step task on the example frontend for well under $0.10; $0.50 is generous but still catches a runaway loop before it becomes expensive. Tune up only with explicit reason.
