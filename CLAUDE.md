# Directory guide

This file is the single source of truth for agents entering the Hover repository. Read this file first. It describes the current implementation and the boundaries agents must respect when working in it.

## Core documentation index

- Product scope and onboarding: `README.md`.
- Architecture and protocols: this file (`CLAUDE.md`), `packages/core/README.md`.
- License: `LICENSE` (Apache-2.0).

## What Hover is

Hover is a **VS Code extension** (`hover-dev`) that puts a chat in the editor. The developer types natural-language instructions ("test the login flow"), an agent drives their *actual* Chrome via CDP + Playwright MCP, and the verified session is one-click crystallized into a standard Playwright `.spec.ts` file under `__vibe_tests__/`. (The original surface was a dev-server-injected widget shipped via bundler plugins — that path has been removed; see Direction.)

The differentiator vs. Stagehand / Midscene / Playwright codegen is the **AI exploration → deterministic script** workflow: AI authors the test, but the saved artifact is plain `@playwright/test` code that runs in CI without an agent in the loop.

## Direction (2026-06)

The **`hover-dev` VSCode extension (`packages/vscode-ext`) is the distribution.** The npm bundler-plugin path — `vite-plugin-hover`, `@hover-dev/astro` / `nuxt` / `next`, `webpack-plugin-hover`, `@hover-dev/cli`, `@hover-dev/widget-bootstrap`, `@hover-dev/transform-source`, plus the in-page widget — has been **removed**: those packages' source is gone. The extension drives any dev server over CDP with no injected widget, so the install-a-plugin step no longer exists. (Published versions of the old packages remain installable from the registry as historical artifacts, but they are no longer part of this repo.)

**`@hover-dev/core` is NOT removed** — it stays the engine, consumed by the extension as *local source* (the extension's `stage-engine` step `npm pack`s the local `packages/core`, never the registry), so core keeps evolving without being (re)published to npm. **Do not delete `core`.** The remaining workspace packages are `core`, `probe-engine`, `api-test`, `pentest`, and `vscode-ext` (plus the `site` docs app and `examples/*`).

## Workspace directories

Workspace packages come from `pnpm-workspace.yaml`: `packages/*` and `examples/*`. The repo is pnpm + ESM throughout.

- `packages/core` is `@hover-dev/core` — the Node service. Owns agent invocation, Playwright CDP preflight, MCP config, and the WebSocket bridge between the extension UI and the agent process.
- `packages/probe-engine` is the private shared probe engine consumed by `@hover-dev/api-test` and `@hover-dev/pentest`.
- `packages/api-test` (`@hover-dev/api-test`) and `packages/pentest` (`@hover-dev/pentest`) are the api-test / pentest mode plugins, staged into the extension's engine. **The orange `api-test` mode (renamed from the old `security` mode) covers BOTH jobs in one mode: functional/contract API testing (drive + verify endpoints) AND the previously-defined security/authz testing (access control, IDOR/BOLA, permissions); confirmed authz findings crystallize to `.api-test.spec.ts`.** Many *internal* identifiers still read `Security*` (`writeSecuritySpec`, `startSecurityRuntime`, `SecuritySeed`, `builtinSecuritySeeds`, …) — deliberately not renamed; only the package, mode id, artifact name, and CI tag changed. (The old bundler-plugin / in-page-widget packages — `vite-plugin-hover`, `@hover-dev/astro` / `nuxt` / `next`, `webpack-plugin-hover`, `@hover-dev/cli`, `@hover-dev/widget-bootstrap`, `@hover-dev/transform-source` — have been removed; their per-bundler integration notes survive only in git history.)
- `packages/vscode-ext` is `hover-dev` — the VSCode extension, Hover's **primary surface** per the security-direction design. ONE extension covers AI test authoring + application-security testing; the normal / api-test (orange) / pentest (red) split is a mode switch over the engine's `set-mode` protocol. **Engine-in-extension (Path A)**: rather than esbuild-bundle `@hover-dev/core` (which fails — playwright-core does a dynamic `require('chromium-bidi/…')` esbuild can't follow), `scripts/stage-engine.mjs` runs `npm pack` on core + a flat `npm install` into `engine/node_modules`, shipped inside the .vsix; `src/engine.ts` spawns `engine/host.mjs` under VSCode's own Node (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`, so no system node needed), and the host prints `HOVER_ENGINE_PORT=<port>` for the WS client pool (`src/serviceClient.ts`, ports 51789–51798) to connect. Surfaces: a chat **webview** (`src/chatView.ts` — grouped run rendering mirroring the in-page widget's reducer: tool steps fold under AI-narration titles, BOUNDARY tools + a per-group cap split groups, markdown→HTML, Findings card, voice narration, a busy-spinner for optimize, mode-colored running border) in its own Activity Bar container, plus native tree views in the `hover` container — **Specs** (folder-grouped: a subfolder of `__vibe_tests__/` is a group; ✨ Optimize runs the pass and auto-opens the candidate diff), **Sessions**, **Environments** (`src/environments.ts` + `environmentsView.ts` — Local + remote targets; the active env drives the run target URL via `resolveTargetUrl()`, remote targets skip the dev-server spawn; roster in `.hover/environments.json` (commit-worthy), account passwords in SecretStorage; active selection in workspaceState), and a **Settings** webview (agent / model / browser silent-vs-visible / speech / model API key). F1 review-optimization-candidate (`src/optimized.ts` shares the candidate path with F3) · F2 element→source · F3 spec CodeLens (`src/specLens.ts`). Cloud-backed pieces (real DNS-TXT domain verification, cross-machine sync, team-shared environments) are present but disabled placeholders until Hover Cloud. Builds with `tsup` to `dist/extension.cjs`; publisher `hyperyond`; **published on the VS Code Marketplace as `hyperyond.hover-dev`** (a local `.vsix` from `pnpm --filter hover-dev package` is sideloaded for dev testing). **This extension is now Hover's distribution** — the npm bundler-plugin packages have been removed (see "Direction" above).
- `examples/basic-app` is the minimal Vite + React app used as the default smoke target — login + counter + todos. Vite port 5173.
- `examples/e-commerce` is an Amazon-style e-commerce SPA: product grid (with category sidebar + search) → product detail → cart → checkout (shipping address + payment method) → success. Payment method offers an inline card form OR a "Pay with PayHover" button that opens the payment-provider in a new tab and listens for the postMessage result. Stresses long action chains, cart state, conditional UI per payment method, and cross-tab popup flows. Vite port 5174.
- `examples/stock-registration` is a realistic brokerage account opening form (think IBKR / Schwab account application). 8 sections, ~50 fields, conditional reveals (foreign-tax fields when not US tax resident, previous address when current < 2 years, employer block when employed/self-employed, PEP/FINRA/control-person follow-ups, ACH bank fields when funding via ACH), multi-select chips, file upload, range slider, compliance acknowledgements. Stresses AI form filling on rich realistic-business controls. Vite port 5175.
- `examples/canvas-paint` is a drawing app: `<canvas>` for the artwork, DOM toolbar for tools/color/brush size. Stresses AI's ability to find DOM controls amidst graphical content (canvas pixels are opaque to Playwright snapshots). Vite port 5176.
- `examples/payment-provider` is a **deliberately unintegrated** mock third-party payment page used as the popup target for e-commerce's "Pay with PayHover" button. Vite port 5177. It represents a simulated third-party origin. Stresses agent behaviour around cross-tab flows: agent must `browser_tabs(action='list')` to discover the new tab, `browser_tabs(action='select')` to switch, operate the page, and verify the original tab advances on `window.opener.postMessage` callback.

(The bundler-dogfood examples — `astro-app` / `nuxt-app` / `next-app` / `webpack-app` / `rn-web-app` — were removed along with the bundler-plugin path; the remaining examples are the testing-surface targets the extension drives.) None of the examples install anything Hover-related — they are plain dev servers; the VS Code extension drives any of them over CDP without an injected widget or in-page service.

## Runtime-created directories

- `__vibe_tests__/` is the write target for crystallized Playwright specs. The directory is created by the runtime; do not hand-author placeholder files there. It holds **only user-facing Playwright code** (`*.spec.ts`, `pages/`) — no Hover-internal files.
- `<devRoot>/.hover/` is the project-root home for ALL Hover-derived data: `sidecars/<slug>.json` (the structured `SpecStep[]` record per spec — relocated from the legacy nested `__vibe_tests__/.hover/`, which readers still fall back to and lazily migrate), `sessions/` (one summary JSON per agent run: agent, model, cost, turns, outcome — `packages/core/src/sessions/sessions.ts`), `cache/` (disposable; optimization candidates live at `cache/optimized/`), plus `conventions.md`. The **full seed/probe catalogue ships built-in as inlined TypeScript constants** — optimization seeds in `packages/core/src/specs/seeds.ts` (`BUILTIN_SEEDS`) and api-test/pentest probes in `packages/probe-engine/src/builtins.ts` (`builtinSecuritySeeds`, inlined into `@hover-dev/api-test` / `@hover-dev/pentest`). The former user-authored-seed surface (`.hover/rules/` files + a `.hover/seeds.json` opt-out) was **removed** — too much burden for a curated catalogue; add a pattern by appending to the relevant constant. Session-ledger writes are best-effort by contract — they must never break a run or Save-as-spec. This repo's root `.gitignore` ignores `.hover/` wholesale (the api-test plugin keeps a MITM CA private key under `.hover/ca/`); in user projects the intended policy is `cache/` ignored, the rest commit-worthy. (A route-graph "atlas" feature was prototyped and removed: every Hover dogfood target is a single-URL state-machine SPA, so a URL-keyed navigation graph had nothing to bite on — see `docs/superpowers/specs/2026-06-12-hover-dir-atlas-design.md` for the post-mortem.)

## Repository status

The full loop is shipped and verified: a sandboxed coding-agent CLI drives the user's Chrome over CDP and crystallizes the run into a plain Playwright spec. The **`hover-dev` VS Code extension** is the active surface (chat + Specs/Sessions/Environments + the in-extension engine; api-test/pentest modes, the `@account` credential vault, and PR-CI workflow generation); it is **published on the VS Code Marketplace** as `hyperyond.hover-dev`. Active work lives on the `feat/security-direction` branch. The bundler-plugin / in-page-widget path has been removed (see Direction).

Modes in the extension: **both 🟠 api-test and 🔴 pentest are wired.** `scripts/stage-engine.mjs` packs `@hover-dev/api-test` AND `@hover-dev/pentest` into `engine/node_modules`, and `host.mjs` loads both into `startService({ plugins })` — `@hover-dev/api-test` (default export → mode `api-test`) and `@hover-dev/pentest/plugin` (the `./plugin` subpath → mode `pentest`; the package's main entry is a report library, not a manifest). pentest reuses api-test's resident MITM + control plane via the exported `startSecurityRuntime()` (refcounted, shared — fn name kept); the two modes are mutually exclusive (`conflictsWith: ['api-test']`). api-test crystallizes confirmed authz findings into `.api-test.spec.ts`; pentest is offensive (origin-locked, in-band) and writes a Markdown findings report. **Runtime caveat:** api-test/pentest pull `mockttp` + `@peculiar/asn1-*` + `get-port`; under the extension's bundled Electron-Node the known ERR_REQUIRE_ESM (get-port) / asn1-schema-collision issues (see FAQ) could surface — plugin load is fail-soft (logs + degrades to "mode unavailable", never blocks engine boot), so verify on a real sideload.

# Architecture

## Local CLI Agent First

Hover bundles no AI runtime. It spawns whatever coding-agent CLI the user already has on PATH (`claude`, `codex`, ...) and normalizes its output into a single event stream.

Supported agents today: `claude` (Claude Code, hard sandbox) and `codex` (OpenAI Codex CLI, soft sandbox). Service auto-detects the primary at startup — first installed in registry order — so a user with only `codex` installed gets Hover working without env vars. The widget shows the current agent as a pill in its header and lets the user pick another from a dropdown that also lists registered-but-not-installed agents (greyed out, with an install hint copy-pasteable from the row).

Files in `packages/core/src/agents/`:

| File | Purpose |
|---|---|
| `types.ts` | `AgentDescriptor`, `InvokeOptions`, normalized `InvokeEvent`, `SandboxStrength`, `AgentDisplay`, protocol/format enums, error classes |
| `registry.ts` | `AGENTS` constant + `listAgents()` — single source of truth for supported agents |
| `detect.ts` | `detectAgents()`, `pickPrimaryAgent()`, `listAgentAvailability()`, `resolveBinForAgent()`, `resolveOnPath()` — PATH scanning + selection |
| `argv.ts` | `buildArgv()` — protocol-aware argv construction |
| `invoke.ts` | `invokeAgent()` — async-iterable: spawn child, parse stream, yield normalized events; calls descriptor's optional `onStreamEnd` to synthesize `session_end` for agents whose protocol lacks an explicit terminator (codex) |
| `claude.ts` | Claude Code descriptor — `claude -p`, stream-json parser, hard sandbox via `--strict-mcp-config` + `--allowedTools` + `--disallowedTools` |
| `codex.ts` | OpenAI Codex descriptor — `codex exec --json`, JSONL parser, soft sandbox via `--sandbox read-only` + `developer_instructions` system prompt (codex has no built-in-tool deny list at the CLI level) |

Per-agent strategy lives in its own file. To add a new agent: write its `AgentDescriptor` and register it in `registry.ts` — nothing else changes.

`AgentDescriptor.sandboxStrength` (`'hard' | 'soft'`) is the load-bearing field that lets `service.ts` decide whether to pass the claude-style allow/disallow lists (no-op for codex, but cleaner to gate at the service layer). A `'soft'` agent gets a ⚠ badge in the widget dropdown so the user knows the built-in tool surface (`shell`, `fs_edit`, etc.) is broader than the MCP-only locked-down `'hard'` agents.

The full flow for one command: page UI → WebSocket → `@hover-dev/core` → spawn agent → MCP → Playwright → CDP → user's Chrome. Step events flow back the same path in reverse.

## Widget-driven Chrome lifecycle

The widget knows the page it's running in (`window.location.href`). The service knows which Chrome it can reach over CDP (`/json/list`). Comparing the two answers a question the user shouldn't have to: "is this widget actually in the debug Chrome?" Three answers:

| State | Meaning | Widget UI |
|---|---|---|
| `same-window` | Origin matches a CDP tab. Agent can drive this very tab. | Normal blue ✨, full UI |
| `wrong-window` | A debug Chrome exists, but this widget isn't in it. | Gray ✨, panel says "use the other window"; click → service runs `Page.bringToFront()` on the matching tab |
| `no-cdp` | No debug Chrome at all. | Amber ✨, panel says "launch debug Chrome"; click → service runs `launchDebugChrome()` |

Wire protocol additions (client → server): `check-cdp { pageUrl }`, `launch-chrome { pageUrl }`, `focus-debug { pageUrl }`. Server → client: `cdp-status { state, launching?, reason?, browser?, matchingTabUrl? }`. Widget fires `check-cdp` on every WS open (including reconnects after HMR).

Origin comparison (not full-URL) is deliberate — the user might be on `/login` while the debug Chrome tab is on `/`; they're the same app and the agent can route within it.

The extension launches the debug Chrome on demand (and `pnpm smoke:chrome` / `pnpm smoke` spawn it for the CLI smoke flow). On-demand launching keeps the default safe — a user who does nothing still gets guided to a working state on first ✨ click.

## Boundary constraints

These are load-bearing — several are non-obvious:

- The **agent** never launches its own Chromium — it connects to whatever debug Chrome is on `chromeDebugPort` via `connectOverCDP` and picks the existing context/page whose URL matches the dev-server origin. The agent's Playwright MCP is sandboxed to a CDP target it can't change.
- The **service** is allowed to spawn one specific Chrome: the isolated debug Chrome under `<tmpdir>/hover-chrome` via `launchDebugChrome()` (in `playwright/launchChrome.ts`). This happens on demand (when the user clicks an amber ✨) or via the smoke scripts. It is *not* the user's primary Chrome profile.
- Sandboxing is per-agent. For `claude` (hard sandbox), the service passes `--strict-mcp-config`, `--permission-mode dontAsk`, `--allowedTools mcp__playwright`, `--disallowedTools "Bash Edit Write Read Grep Glob Task WebFetch WebSearch …"`. The Playwright MCP server is the only tool Claude can reach; filesystem access (other than the `__vibe_tests__/` write path) is forbidden. For `codex` (soft sandbox), there is no equivalent CLI flag to disable built-in tools — we pass `--sandbox read-only --ask-for-approval never` and inject a strict `developer_instructions` system prompt telling the agent to use only `mcp__playwright__*`. The widget marks soft-sandbox agents with a ⚠ badge so users know the surface is broader.
- Default model is `sonnet`, not `opus`. Opus is ~5× more expensive per browser-driving session. Override with `HOVER_MODEL=opus` if needed for harder tasks.
- The injected UI lives in a Shadow DOM and marks itself with `data-vibe-test="true"` so Playwright can skip it. Tailwind's default scan does not work inside Shadow DOM — use inline styles or CSS-in-JS.
- The local Node service binds to `127.0.0.1` only.
- Generated Playwright code prefers `page.getByRole` / `page.getByText` over CSS/XPath selectors.
- **Grounded actuation (normal mode).** The Playwright MCP interaction tools (`browser_click` / `browser_type` / `browser_fill_form` / `browser_select_option`) take a free-form `element` description that doesn't round-trip to a replayable selector (crystallizes as a confabulated `getByText`). In normal mode they are DENIED; the agent interacts through the Hover control-actuation MCP (`packages/core/src/mcp/actuateServer.ts`, server id `hover-control`) — `click_control` / `fill_control` / `select_control` / `check_control`, which take a grounded target (role+name → testId → text, read off the snapshot) and run it via `page.getByRole(...)` over CDP. The selector that drives the action IS the one crystallized, so record == replay. Security / pentest keep the Playwright tools (they explore to capture traffic, not to crystallize browser steps). Deny-list + system-prompt directive live in `service.ts` (gated on `currentModeId === null`); `writeSpec` translates each `*_control` step with the matching `getByRole`/`getByTestId`/`getByText`.
- Cookies / localStorage never transit the Node service; auth state stays inside the browser and is handled by Playwright in-process.
- Child-process stdio must be drained, or the spawned agent deadlocks.
- WebSocket reconnect must be robust because Vite HMR will tear down the page repeatedly during normal dev.
- Output is standard `@playwright/test` files. No proprietary test format.

## Billing risk (active)

Starting **2026-06-15**, `claude -p` calls draw from a new monthly Agent SDK credit pool separate from interactive limits. Pro: $20, Max 5x: $100, Max 20x: $200. Overage flows to API rates if usage credits are enabled, otherwise hard cutoff until refresh. Two mitigations are already in place:

1. `--max-budget-usd` ceiling per invocation (currently $0.50 in `smoke.ts`). Claude-only — codex doesn't accept this flag.
2. Local CLI Agent First — `codex` is wired (v0.3.0). Users can switch agents from the widget dropdown if `claude` becomes expensive for them, with no env-var dance. `cursor-agent`, `aider`, `gemini-cli` etc. remain one-file additions to `registry.ts`.

# Development workflow

## Environment baseline

- Runtime is Node 24+, pnpm 10+. The repo is ESM throughout. No CJS at the source layer.
- `tsconfig.base.json` at the root is the shared TS config every package extends. There is no root `tsconfig.json` — typecheck runs per-package via `pnpm typecheck`.
- Test stack: Vitest for unit tests (per-package, under `packages/*/tests/`), Playwright dogfooding for integration (crystallized specs under `examples/basic-app/__vibe_tests__/`). No linter or formatter is configured yet.

## Package entry-point conventions

Most Hover packages set `main` / `exports` to `src/*.ts`, so consumers' transpilers (Vite, esbuild, tsx) see TypeScript source with zero build step.

**Exception: `@hover-dev/core`** points `main` / `exports` at `dist/*.js` (and ships a `dev: tsc --watch`). Reason: the VS Code extension's staged engine resolves `@hover-dev/core/dist/service.js` (`host.mjs` imports `@hover-dev/core/service`), so core must build to `dist`. A root `postinstall` builds core (plus the api-test / pentest plugins) after every `pnpm install`, so fresh clones have usable `dist/`. Editing `core/src/` during extension dev needs a `pnpm --filter @hover-dev/core build` (or a `dev` watch terminal) so the staged engine picks it up; `pnpm --filter hover-dev package` re-packs core fresh into the `.vsix`.

## Local lifecycle

Two terminals on first run; once Chrome and Vite are up they stay running across many smoke loops:

1. `pnpm dev:example:basic-app` — basic-app at http://localhost:5173. (Same for `dev:example:e-commerce` / `…:stock-registration` / `…:canvas-paint` on 5174 / 5175 / 5176.) Spawn the debug Chrome (`--remote-debugging-port=9222`, isolated profile at `<tmpdir>/hover-chrome`) separately with `pnpm smoke:chrome`.
2. `pnpm smoke` — end-to-end: detect agents → CDP preflight → invoke `claude` → stream events.

Need the debug Chrome without a Vite example? `pnpm smoke:chrome` standalone-spawns it (same `<tmpdir>/hover-chrome` profile, idempotent).

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
- `<scope>` is the package or sub-area: `core`, `vscode-ext`, `api-test`, `pentest`, `probe-engine`, `example`, `agents`, `playwright`, `mcp`, `ci`, `deps`.
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

- Unit tests: **Vitest**, per-package, in `packages/*/tests/` sibling to `src/`. Run with `pnpm --filter @hover-dev/core test` or `pnpm test` at the root (which fans out across the workspace). Keep `src/` source-only; do not place `*.test.ts` inside `src/`. Current coverage: `packages/core/tests/agents/` (argv dispatcher, claude descriptor, registry).
- Integration / e2e: **Playwright dogfooding**. Crystallized specs land under `examples/basic-app/__vibe_tests__/` and run with standard `@playwright/test`. The agent must not be involved at CI time — only the Playwright script runs. Bootstrap on a fresh machine: `pnpm --filter basic-app exec playwright install chromium`. Run with `pnpm test:e2e`.
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
pnpm --filter hover-dev package    # build + stage engine + vsce package → hover-dev-<v>.vsix (sideload into VS Code)
pnpm dev:example:basic-app         # http://localhost:5173 — login / counter / todos
pnpm dev:example:e-commerce        # http://localhost:5174 — Amazon-style storefront (cart / checkout / popup)
pnpm dev:example:stock-registration # http://localhost:5175 — ~50-field brokerage form
pnpm dev:example:canvas-paint      # http://localhost:5176 — canvas + DOM toolbar
pnpm dev:example:payment-provider  # http://localhost:5177 — mock third-party popup origin
pnpm smoke:chrome         # launch debug-mode Chrome (--remote-debugging-port=9222)
pnpm smoke                # end-to-end: detect agents → CDP preflight → invoke claude (core engine)
pnpm detect               # list installed coding agents
pnpm ws-smoke             # exercise the @hover-dev/core WebSocket bridge in isolation
pnpm bench-ttfb [n=5]     # time the LLM-driven loop's first tool_use latency (needs Chrome on :9222 + a dev server)
```

```bash
pnpm --filter @hover-dev/core test
pnpm --filter @hover-dev/core typecheck
pnpm --filter hover-dev typecheck
pnpm --filter basic-app dev
```

# FAQ

## Why is the default model `sonnet` and not `opus`?

A typical browser-driving session with `opus` costs ~5× the equivalent `sonnet` session. Hover is meant to run continuously during dev; default to `sonnet`. Set `HOVER_MODEL=opus` per-invocation when you need it.

## Why does Hover use an isolated debug Chrome instead of attaching to the user's normal browser?

Hover launches its own debug Chrome under `<tmpdir>/hover-chrome` (a persistent user-data-dir, reused across runs) and connects to it over CDP. It deliberately does *not* attach to the user's primary Chrome profile: doing so would require the user to relaunch their everyday browser with `--remote-debugging-port` and would expose every tab, cookie, and extension on their main session to whatever the agent does. The trade-off is honest: the user has to log into the app once inside the debug Chrome, but from that point on the profile dir persists session state across Hover commands and dev-server restarts.

The CDP entry point (`connectOverCDP` against an *already-running* debug Chrome) is still load-bearing: the agent never spawns its own Chromium, never operates a fresh headless context, and always lands on the existing tab whose URL matches the dev-server origin.

## Why is filesystem access disallowed on the agent?

The agent only needs the Playwright MCP server — that is enough to drive the browser end-to-end. Allowing `Bash`, `Edit`, `Write`, `Read`, etc. dramatically widens the blast radius if the prompt is hijacked or if the agent hallucinates a destructive action. The single write path (eventually under `__vibe_tests__/`) is granted by the Node service, not by the agent's tool list.

## Why is the UI in a Shadow DOM?

Two reasons: (1) style isolation from the host app, so Hover's CSS does not bleed into the page under test, and (2) Playwright tests must be able to skip Hover's own DOM — the `data-vibe-test="true"` marker on the Shadow root makes the filter trivial. Tailwind's content scanner does not see inside Shadow DOM; use inline styles or CSS-in-JS.

## Why `--max-budget-usd 0.50`?

A safety belt against runaway prompts. Phase 0 sessions empirically complete a 5-step task on the example frontend for well under $0.10; $0.50 is generous but still catches a runaway loop before it becomes expensive. Tune up only with explicit reason.

## "ERR_REQUIRE_ESM" when loading `@hover-dev/api-test` under Next?

Symptom: `require() of ES Module .../get-port/index.js from .../mockttp/dist/server/mockttp-server.js not supported`. Chain is `@hover-dev/api-test` → `mockttp@4.4.2` → `require('get-port')` → `get-port@7.x` (ESM-only). `mockttp` upstream is aware — see [httptoolkit/mockttp#200](https://github.com/httptoolkit/mockttp/issues/200) (open as of 2026-05) — but ships no fix yet.

Workarounds, by preference:

1. **Upgrade to Node ≥ 22.12** — Node added sync `require(ESM)` in 22.12, so the load succeeds out of the box. `@hover-dev/api-test` declares `engines.node >= 22.12.0` for this reason. Older Node still emits the runtime error.
2. **Pin `get-port` to v6 in your project's overrides**:
   ```json
   { "pnpm": { "overrides": { "get-port": "^6.1.2" } } }
   ```
   (npm: `"overrides"` at top level; yarn: `"resolutions"`.) get-port@6.x is CJS and `mockttp`'s `require()` works.
3. **Remove the `@hover-dev/api-test` plugin from your `register()` call** if you don't need MITM mode — Hover works fine without it.

We can't fix this from inside `@hover-dev/api-test`: npm overrides only flow from the consumer's root package.json, so a published dep can't override a sibling dep's resolution.

## "Cannot get schema for 'PrivateKeyInfo' target" when enabling api-test mode?

Symptom: the widget reports `[hover/mitm] CA generation failed: @peculiar/asn1-schema schema-registry collision`. Root cause: `@peculiar/asn1-schema` keeps its ASN.1 schema definitions on a per-module-instance singleton. When two copies of the package end up in the consumer's `node_modules` (pnpm hoisting + Next 15's module-resolution combine produces this readily), PKI deps register schemas into copy A's registry but the runtime lookup walks copy B's empty one → schema not found.

`@hover-dev/api-test` declares `@peculiar/asn1-schema@2.6.0` as a direct dependency to give pnpm a strong hint, but inside the consumer's tree mockttp's own sub-deps may still pull in a sibling copy.

Fix from the consumer's root package.json:

```json
{ "pnpm": { "overrides": { "@peculiar/asn1-schema": "2.6.0" } } }
```

(npm: `"overrides"` at top level; yarn: `"resolutions"`.) Then `rm -rf node_modules && pnpm install` to collapse to one copy. Verify with `pnpm why @peculiar/asn1-schema` — should show exactly one resolved version.

The startProxy() loop now detects this exact error message and rewrites it into the fix recipe, so the widget panel shows a useful error instead of a generic `no free port` swallowed-error trail.

Tracking upstream: [PeculiarVentures/asn1-schema#111](https://github.com/PeculiarVentures/asn1-schema/issues/111).
