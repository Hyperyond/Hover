# Directory guide

This file is the single source of truth for agents entering the Hover repository. Read this file first. It describes the current implementation and the boundaries agents must respect when working in it.

## Core documentation index

- Product scope and onboarding: `README.md`.
- Architecture and protocols: this file (`CLAUDE.md`), `packages/core/README.md`.
- License: `LICENSE` (Apache-2.0).

## What Hover is

Hover is an **MCP server** (`@hover-dev/mcp`) that the user adds to their *own* coding agent (Claude Code, Cursor, …). The user's agent drives the user's debug Chrome over CDP through Hover's **grounded actuation** tools, then crystallizes the session into a plain `@playwright/test` `.spec.ts` file under `__vibe_tests__/`. Hover bundles **no AI runtime** and manages **no model** — the calling agent is the intelligence (BYO-CLI). Install globally, then register the bin:

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

The differentiator vs. Stagehand / Midscene / Playwright codegen is **record == replay**: grounded actuation means the selector that drove the action IS the one saved, and crystallization is **deterministic** — a string-template translation of the recorded grounded-step buffer, with **no LLM in the codegen path**. The saved artifact is plain Playwright that runs in CI with no agent in the loop.

## Direction (MCP-first, 2026-06)

Hover pivoted **from** a VS Code extension that *was* the engine — a chat that spawned a sandboxed agent plus an in-extension staged engine (`host.mjs`, a WS client pool, a packed copy of `core`) — **to MCP-first**: the engine plugs into the user's own agent over MCP. A standalone interactive TUI that was briefly built has been deleted. The VS Code extension was **gutted into a passive review cockpit** that drives no agent and ships no engine.

Earlier history (for context only): a pre-extension surface was a dev-server-injected widget shipped via bundler plugins (`vite-plugin-hover`, `@hover-dev/astro` / `nuxt` / `next`, `webpack-plugin-hover`, `@hover-dev/cli`, `@hover-dev/widget-bootstrap`, `@hover-dev/transform-source`). All of those were removed long ago; their source is gone and only git history retains it.

## Workspace directories

Workspace packages come from `pnpm-workspace.yaml`: `packages/*` (plus the `site` docs app). The repo is pnpm + ESM throughout.

- `packages/core` is `@hover-dev/core` — the **engine library**. Owns grounded-actuation logic, `writeSpec` (the deterministic crystallizer), grounded-step replay (`replayGroundedSteps`), the optimize / architecture passes (ts-morph), business memory (`.hover/memory/`), `launchDebugChrome`, and the `@hover-dev/core/engine` barrel. Published to npm (public). Its **only consumer now is `@hover-dev/mcp`** — the extension no longer touches it, so the old WS staged-engine surface (`runSession`, the `./service` host + `service/*`, the Playwright-MCP config in `resolveMcpConfig` / `buildGroundedMcpConfig`, and the `mcp/actuateServer` + `sourceServer` relays) has been **removed**, and `@playwright/mcp` is no longer a dependency (it dragged ~29 MB of full Playwright into every install for nothing). `main` / `exports` point at `dist/*.js`. **Do not delete `core`.**
- `packages/mcp` is `@hover-dev/mcp` (bin `hover-mcp`) — the **MCP stdio server**, the thin frontend and the only public-facing install. Depends on `core` via `workspace:*`. Exposes grounded browser tools — `browser_navigate`, `browser_snapshot`, `click_control`, `fill_control`, `select_control`, `check_control`, `assert_visible` — plus `recall_business_knowledge` / `record_fact` and `crystallize_spec`, and a `test_app` **MCP prompt** (the phased explore → business-map → crystallize workflow, surfaced in Claude Code as `/mcp__hover__test_app`). It spawns no agent: the calling agent IS the intelligence; Hover guarantees record == replay at the output. Config via env: `HOVER_TARGET`, `HOVER_CDP_PORT`, `HOVER_PROJECT_ROOT`. **Published lockstep with `core` on `v*` tags** (pnpm rewrites mcp's `workspace:*` core ref to the just-published core version). Users add the MCP and `core` comes along as a dep — they never install `core` directly.
- `packages/vscode-ext` is `hover-dev` — the VS Code extension, now a **passive review cockpit**. It drives no agent and ships no engine. Surfaces:
  - **Business Map** (`src/businessMap.ts` + `businessMapView.ts`) — a reactflow graph of `.hover/hover-map.md`: business lines → specs, coverage-colored; its own Activity Bar icon plus a full editor panel.
  - **Dashboard** (`src/dashboardView.ts`) — the spec × run health matrix + CI sync (`src/githubCi.ts` / `ciWorkflow.ts`), an "Install Hover MCP" button, and a gethover.dev link.
  - **Environments** (`src/environments.ts` + `environmentsView.ts`) — Local + remote targets; roster in `.hover/environments.json` (commit-worthy), account passwords in SecretStorage, active selection in workspaceState.
  - **Specs CodeLens (F3)** (`src/specLens.ts`) and **Run** — runs specs via the user's own Playwright in a terminal.

  GUTTED / REMOVED: the chat webview; the in-extension engine (`host.mjs`, `serviceClient`, the staged `engine/` dir, `scripts/stage-engine.mjs`); mode switching (normal / api-test / pentest / QA); and Heal / Optimize (no engine to run them). F2 (element → source) was deferred — it needed the cut WS relay. Builds with `tsup` to `dist/extension.cjs`; webview via Vite (`build:webview`). Publisher `hyperyond`; **published on the VS Code Marketplace + Open VSX as `hyperyond.hover-dev`** on its own `vscode-v*` tags. The `.vsix` is ~220 KB (no staged engine). A local `.vsix` from `pnpm --filter hover-dev package` is sideloaded for dev testing.
- `site` is the docs app (`@hover-dev/site`).

(The `examples/*` dogfood test-target apps that used to live here — `basic-app`, `e-commerce`, `stock-registration`, `canvas-paint`, `payment-provider` — have been **removed**; future test targets live separately. There is no `pnpm dev:example:*` / `pnpm test:e2e` anymore.)

## Runtime-created directories

- `__vibe_tests__/` is the write target for crystallized Playwright specs. The directory is created by the runtime; do not hand-author placeholder files there. It holds **only user-facing Playwright code** (`*.spec.ts`, `pages/`) — no Hover-internal files.
- `<devRoot>/.hover/` is the app's **living test wiki** (LLM-maintained, compounding, owned by the user's repo) and the home for all Hover-derived data:
  - `hover-map.md` — the business map the agent maintains (rendered by the extension's Business Map view).
  - `memory/*.md` + `MEMORY.md` — business rules / facts written via `record_fact` (`packages/core/src/memory/businessMemory.ts`) and recalled via `recall_business_knowledge`.
  - `sidecars/<slug>.json` — the structured `SpecStep[]` record per spec (readers fall back to the legacy nested `__vibe_tests__/.hover/` and lazily migrate).
  - `runs/<id>.json` — the **Playwright spec-run-results** ledger (written by ▶ Run / CI sync, read by the Dashboard).
  - `log.md` — the **append-only run history** (LLM-Wiki P3), one machine-parseable `- <ISO> · <kind> · <summary>` line per wiki mutation (crystallize / api / extract), written deterministically by `appendWikiLog` (`packages/core/src/specs/wikiLog.ts`) as the MCP server crystallizes/extracts. Best-effort; never breaks a write.
  - `conventions.md` — project conventions.
  - `cache/` — disposable (optimization candidates live at `cache/optimized/`).

  The optimization seed catalogue ships built-in as inlined TypeScript constants in `packages/core/src/specs/seeds.ts` (`BUILTIN_SEEDS`). Wiki / ledger writes are best-effort by contract — they must never break a run or crystallize. This repo's root `.gitignore` ignores `.hover/` wholesale; in user projects the intended policy is `cache/` ignored, the rest commit-worthy.

## Repository status

The MCP-first loop is shipped: `@hover-dev/mcp` plugs into the user's own coding agent, the agent drives the user's debug Chrome through Hover's grounded tools, and the run crystallizes into a plain Playwright spec via the deterministic `writeSpec` path. `@hover-dev/core` + `@hover-dev/mcp` publish **lockstep** on `v*` tags. The **`hover-dev` VS Code extension** is now a passive **review cockpit** (Business Map + Dashboard + Environments + Specs/Run) — it drives no agent and ships no engine — published on its own `vscode-v*` tags to the VS Code Marketplace + Open VSX as `hyperyond.hover-dev`. The old `@hover-dev/probe-engine` / `api-test` / `pentest` plugins and the agent-spawning layer (`agents/*`) have been **removed**: they belonged to the in-extension staged engine and contradict the MCP-first BYO-CLI model (core never spawns a model — the user's own agent is the intelligence). The api/pentest capability is slated to return as agent-driven prompts, not bundled probe code.

# Architecture

## MCP-first, BYO-CLI

Hover bundles no AI runtime and picks no model. The user adds `@hover-dev/mcp` to whatever coding agent they already run (`claude`, `cursor`, …); that agent calls Hover's grounded tools and `crystallize_spec`. The deterministic crystallize path is pure string templates — no LLM. The optimize / refactor passes (ts-morph) run on the **user's own agent/model**, never a Hover-picked model. (Any earlier "default sonnet / cheap-model optimize" framing is obsolete — Hover no longer owns a model choice.)

The full flow for one command: user's agent → MCP (`hover-mcp`) → `@hover-dev/core` grounded actuation → Playwright over CDP → user's debug Chrome. The grounded-step buffer accumulates as the agent acts; `crystallize_spec` translates it 1:1 into a `.spec.ts`.

## Debug-Chrome lifecycle

`hover-mcp` lazily launches/connects the debug Chrome (`getPage` in `packages/mcp/src/mcp.ts`): `launchDebugChrome({ port, url })` then `chromium.connectOverCDP`. It picks the existing context/page whose **origin** matches `HOVER_TARGET` (origin, not full URL — the user might be on `/login` while the tab is on `/`; same app, the agent routes within it). It connects to an *already-running* debug Chrome and never spawns the user's primary Chrome profile.

## Boundary constraints

These are load-bearing — several are non-obvious:

- The **agent** never launches its own Chromium — Hover connects to a debug Chrome via `connectOverCDP` and picks the existing page whose origin matches `HOVER_TARGET`. The agent acts only through Hover's MCP tools.
- Hover is allowed to spawn exactly one Chrome: the isolated debug Chrome under `<tmpdir>/hover-chrome` via `launchDebugChrome()` (`packages/core/src/playwright/launchChrome.ts`). It is *not* the user's primary Chrome profile.
- **Grounded actuation is the moat.** The agent never uses Playwright MCP's loose `browser_click` / `browser_type` (which take a free-form `element` description that doesn't round-trip to a replayable selector and crystallizes as a confabulated `getByText`). It actuates through Hover's grounded control tools (`click_control` / `fill_control` / `select_control` / `check_control` / `assert_visible`), which take a **grounded target** (role+name → testId → text, read off the snapshot) and run it via `page.getByRole(...)` over CDP. The selector that drives the action IS the one crystallized, so record == replay. `writeSpec` translates each grounded step into the matching `getByRole` / `getByTestId` / `getByText`. The grounded deny-list + directive live in `core` (`GROUNDED_ACTUATION_DENY` / `GROUNDED_ACTUATION_DIRECTIVE`, exported from `engine.ts`).
- Generated Playwright code prefers `page.getByRole` / `page.getByText` over CSS/XPath selectors.
- Cookies / localStorage never transit Hover; auth state stays inside the browser and is handled by Playwright in-process.
- Child-process stdio must be drained, or a spawned process deadlocks.
- `hover-mcp` speaks MCP over **stdio** — never write to stdout from that process; logs go to stderr only.
- Output is standard `@playwright/test` files. No proprietary test format.

# Development workflow

## Environment baseline

- Runtime is Node 24+ (the MCP package declares `engines.node >= 20`), pnpm 10+. The repo is ESM throughout. No CJS at the source layer.
- `tsconfig.base.json` at the root is the shared TS config every package extends. There is no root `tsconfig.json` — typecheck runs per-package via `pnpm typecheck`.
- Test stack: Vitest for unit tests (per-package, under `packages/*/tests/`), Playwright dogfooding for integration (crystallized specs run under a target app's `__vibe_tests__/`). No linter or formatter is configured yet.

## Package entry-point conventions

Most Hover packages set `main` / `exports` to `src/*.ts`, so consumers' transpilers see TypeScript source with zero build step.

**Exception: `@hover-dev/core`** points `main` / `exports` (including the `./engine` barrel) at `dist/*.js` and ships a `dev: tsc --watch`. Reason: `@hover-dev/mcp` imports `@hover-dev/core/engine`, so core must build to `dist`. A root `postinstall` (`scripts/postinstall-build.mjs`) builds core after every `pnpm install`, so fresh clones have usable `dist/`. Editing `core/src/` during MCP dev needs a `pnpm --filter @hover-dev/core build` (or a `dev` watch terminal) so the consumer picks it up.

## Local lifecycle

To exercise the MCP loop end to end:

1. Start any target dev server (a plain Vite/Next/etc. app; nothing Hover-related is installed in it).
2. Build the MCP + core (`pnpm --filter @hover-dev/mcp build`, which pulls core), or install the published package globally (`npm i -g @hover-dev/mcp`).
3. Add the server to your own coding agent (`npm i -g @hover-dev/mcp && claude mcp add hover -- hover-mcp`), set `HOVER_TARGET` to the dev-server URL, and drive the app. Hover launches the isolated debug Chrome (`--remote-debugging-port`, profile at `<tmpdir>/hover-chrome`) on demand.

For the extension cockpit: `pnpm --filter hover-dev package` → sideload the `.vsix` into VS Code to review the Business Map / Dashboard / run specs.

## Git commit policy

- Use Conventional Commits. Format: `<type>(<scope>): <description>`.
- Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`.
- `<scope>` is the package or sub-area: `core`, `mcp`, `vscode-ext`, `site`, `playwright`, `ci`, `deps`.
- Commit messages are written in **English**. Hover is a public open-source repo; contributors come from everywhere.
- The subject line is imperative, ≤72 characters, no trailing period.
- Conventional Commits is enforced at commit time by a husky `commit-msg` hook running `commitlint`. The hook installs on `pnpm install`. Do not bypass it with `--no-verify` unless you have explicit owner sign-off.
- Stage files explicitly by name. Do not use `git add -A` / `git add .` — this avoids accidentally committing secrets or large binaries.
- Never amend a previous commit unless explicitly requested. Create a new commit instead.
- Never force-push to `main`. Never skip hooks. Never modify git config.

## Branching policy

- `main` must stay runnable. Every commit pushed to `main` should, in theory, leave the basic flow (`pnpm install` → `pnpm typecheck` → `pnpm test`) intact. This is what makes `git bisect` meaningful.
- Speculative or exploratory work goes on a branch: `git checkout -b experiment/<name>`. Commit messily; if it works merge to `main`, if not delete the branch.
- Feature work: `feat/<name>`. Bug fixes: `fix/<name>`.

## Milestone tags

Tag versions at meaningful milestones so the history has anchor points:

- `v0.0.1-poc` — Phase 0 (end-to-end feasibility) verified.
- `v0.1.0` — Phase 1 (chat UI + persistent service) shipped.

Tag scheme today (the prefix decides what publishes): `v*` → `@hover-dev/core` + `@hover-dev/mcp` lockstep; `vscode-v*` → the `hover-dev` extension (Marketplace + Open VSX). See `.github/workflows/publish.yml`.

## Test strategy

- Unit tests: **Vitest**, per-package, in `packages/*/tests/` sibling to `src/`. Run with `pnpm --filter @hover-dev/core test` or `pnpm test` at the root (which fans out across the workspace). Keep `src/` source-only; do not place `*.test.ts` inside `src/`.
- Integration / e2e: **Playwright dogfooding**. Crystallized specs land under a target app's `__vibe_tests__/` and run with standard `@playwright/test`. The agent must not be involved at CI time — only the Playwright script runs.
- Manual end-to-end (agent in the loop): add `hover-mcp` to your own coding agent and drive a target app by hand. There is no scripted smoke loop; it is not part of CI.

## Validation strategy

Before marking work ready:

1. `pnpm typecheck` — fans out to every package.
2. `pnpm test` — Vitest, fans out across packages with tests.
3. The Playwright dogfood run (or a hand drive of the MCP / sideload of the extension) that matches the files changed.

# Common commands

```bash
pnpm install              # workspace install (also runs husky install via `prepare`, + postinstall build of core/plugins)
pnpm typecheck            # tsc --noEmit, per-package
pnpm test                 # vitest, per-package (where present)
pnpm build                # build core + mcp
pnpm --filter @hover-dev/mcp build   # build the MCP server (pulls core's dist)
pnpm --filter hover-dev package      # build + vite webview + vsce package → hover-dev-<v>.vsix (sideload into VS Code)
```

```bash
pnpm --filter @hover-dev/core test
pnpm --filter @hover-dev/core typecheck
pnpm --filter @hover-dev/mcp typecheck
pnpm --filter hover-dev typecheck
```

# FAQ

## Why does Hover use an isolated debug Chrome instead of attaching to the user's normal browser?

Hover launches its own debug Chrome under `<tmpdir>/hover-chrome` (a persistent user-data-dir, reused across runs) and connects to it over CDP. It deliberately does *not* attach to the user's primary Chrome profile: doing so would require relaunching the everyday browser with `--remote-debugging-port` and would expose every tab, cookie, and extension on the main session to whatever the agent does. The trade-off is honest: the user logs into the app once inside the debug Chrome, but from that point on the profile dir persists session state across runs and dev-server restarts.

The CDP entry point (`connectOverCDP` against an *already-running* debug Chrome) is load-bearing: Hover never spawns a fresh headless context and always lands on the existing tab whose origin matches `HOVER_TARGET`.

## Why grounded actuation instead of Playwright MCP's `browser_click`?

Playwright MCP's interaction tools take a free-form `element` description that doesn't round-trip to a replayable selector — it crystallizes as a confabulated `getByText` that breaks on replay. Hover's grounded control tools take a structured target (role+name → testId → text) read off the snapshot and run it via `page.getByRole(...)`. The selector that drove the action IS the one saved, so record == replay holds. This is the whole point.

## Why is filesystem access kept off the calling agent's browser path?

The agent only needs Hover's MCP tools to drive the browser end to end. The single write path (the crystallized spec under `__vibe_tests__/`) is taken by `writeSpec` in `core`, not by the agent issuing arbitrary writes — which keeps the blast radius small if the prompt is hijacked or the agent hallucinates a destructive action.

## Why did api-test / pentest get removed?

They were plugins of the old in-extension staged engine (the WS host + `runSession`), and they relied on Hover spawning a model itself (the `agents/*` CLI adapters). That contradicts the MCP-first BYO-CLI model — **core never spawns a model**; the user's own coding agent is the intelligence. The api/pentest capability is slated to return as **agent-driven prompts** (the user's agent runs the probes through Hover's grounded tools), not as a bundled `mockttp` / probe-engine runtime — which also retires the old `get-port` ESM and `@peculiar/asn1-schema` dependency headaches those packages carried.
