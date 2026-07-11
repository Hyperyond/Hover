# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are ISO 8601, UTC.

All notable changes to Hover are recorded here. Conventional Commits in the git log are the source of truth; this file groups them by user-visible impact.

## [0.46.0] — 2026-07-11

### Added

- **core/mcp:** `guard` now auto-distills its acceptance criteria into a line-scoped `expected-behavior` rule in `.hover/memory` (not just the map's `Note:`). This is the intent Hover Cloud's verdict judge scores a failure against and the "rule changed recently → lean drift" signal watches — so declaring a guard now populates the judge's evidence for free, no separate `record_fact` needed for the criteria. Idempotent per line; best-effort (never fails the declaration).

## [Unreleased]

- **cloud + core (0.44.0) + vscode-ext (0.42.0):** a test account configured in the Cloud dashboard is now usable for local login. The dashboard wrote the password only to GitHub Actions secrets (CI's write-only channel), so the MCP and editor could never read it back and `account_secrets` stayed empty. Now the dashboard also encrypts the credential into `account_secrets`, the MCP pulls it at run time, core adds `fetchCredentialPresence` (`?meta=1`, presence-only), and the panel marks Cloud-stored accounts with ☁🔑 / "credentials available from Hover Cloud". Removing the account clears both stores.
- **vscode-ext (0.41.0):** fix — Cloud-managed test accounts now appear on their environment card in the panel (importing an environment copied name+URL but not its accounts; the panel now reconciles them in, silent + idempotent).

## [0.43.0] — 2026-07-10

### Added

- **core/mcp:** Cloud-synced test-account credentials. `fill_control`'s `valueFromEnv` now resolves through a three-rung chain — `process.env` → re-read `.hover/.env` → pull the project's Cloud-synced credentials (signed in + linked repo; one fetch per process, cached in memory only, never written to disk). Fresh machines and teammates log test accounts in without a manual export; the secret still never enters the agent's context. core adds `fetchCredentials` / `pushCredential`.
- **vscode-ext (0.40.0):** opt-in account sync to Hover Cloud — after setting a password the editor offers "Sync to Cloud" (encrypted at rest server-side), plus a bulk `Hover: Sync Test Accounts to Hover Cloud` command. Passwords stay in SecretStorage locally; syncing is always a choice, never a default.

## [0.42.0] — 2026-07-10

### Added

- **mcp:** credential env indirection for `fill_control`. The agent names the variable (`valueFromEnv: "HOVER_USER_PASS"`), the SERVER resolves it (re-reading `.hover/.env` lazily — no restart after an export) and types the real value; the secret never enters the agent's context. A literal value matching `process.env.HOVER_X` / bare `HOVER_X` is rescued and resolved instead of typed; an unset var refuses to type anything and says how to fix it. `cloud_context` prints each account's exact `valueFromEnv` names, and the workflow's login guidance teaches indirection first. Fixes the field bug where an agent typed the literal `process.env.HOVER_USER_USER` into a login form.

## [0.41.0] — 2026-07-10

### Added

- **mcp:** the `/mcp__hover__*` command menu is localized. `HOVER_LANG` already set the language the agent converses in; now, when it names a Chinese variant (`zh`, `zh-CN`, `中文`, …), the 7 workflow commands (test_app, optimize, lint, ask, heal, guard, build) also show their title + description in Simplified Chinese in Claude Code's slash-command picker. Arg names stay English (identifiers); other languages fall back to English until translated.

## [0.40.0] — 2026-07-10

### Added

- **core/mcp:** the API layer lands on the business map. `crystallize_api_spec` now upserts its locked contracts into a conventional `## API` area on `hover-map.md` — one covered line per api spec with its `METHOD /path` endpoints. Zero new map syntax (every existing parser reads it as-is); idempotent by spec filename; a map hiccup never fails the crystallize. The map now shows both perspectives: what users do (UI flows) and what the app promises over the wire (API contracts).
- **vscode-ext (0.39.0):** API lines render with a 🛡 in the full Business Map graph and as hexagons in the Mermaid export — distinguishable at a glance, same run/coverage coloring.
- **vscode-ext (0.38.0):** Copy the Business Map as a Mermaid flowchart (Map-tab button + command) — a GitHub-renderable, shareable projection of the map with coverage/run coloring. Export-only; the checklist stays the source of truth.

## [0.39.0] — 2026-07-10

### Added

- **mcp:** `/mcp__hover__build` now runs the verify fidelity ladder explicitly — `verify_specs` (fast) protects the estate every inner round, `verify_specs` (faithful) gates the push, `cloud_run_result` stays the authority.
- **mcp:** `hover-hook install --gate` — an opt-in Stop gate: at turn end the hook replays the crystallized flows (sharing the MCP's debug Chrome over CDP, launching one if absent) and BLOCKS the finish with the exact red list while any fail. "No green, no done." Fail-open on every setup gap (no specs / app down / missing creds / errors) and honors `stop_hook_active` so a block can't loop.
- **core:** `loadHoverEnvFile` — the shared `.hover/.env` loader (MCP server + hooks resolve `HOVER_<LABEL>_USER/PASS` the same way).

## [0.38.0] — 2026-07-10

### Added

- **mcp:** `verify_specs` — the inner-loop check before a push. Batch-verifies flows after a code edit without leaving the agent loop: mode `fast` (default) replays each spec's recorded grounded steps against the live app in seconds; mode `faithful` runs the REAL spec files via `playwright test` (the same engine + files CI runs, `BASE_URL` = the active target). Structured pass/drift/blocked per spec with the exact broken step; a credentials preflight marks missing-env specs `blocked — NOT drift` before anything runs. Read-only and self-labeling: local green means "worth pushing"; CI remains the source of truth.

## [0.37.0] — 2026-07-08

### Fixed

- **core:** replay typed the LITERAL `process.env.X ?? ''` into fills — sidecar credentials are stored as that code expression and replay never resolved it, so any redacted login replayed as garbage and read as drift. Fills/selects now resolve the expression from the environment; a referenced-but-unset var throws with the exact fix.
- **mcp:** fail-fast setup preflights — an unreachable target stops BEFORE launching a browser with a message naming where the target came from (HOVER_TARGET / active environment / default); `replay_spec` refuses to run with missing credential env vars ("not drift — do not heal"); `cloud_run_result`'s pending message says when to suspect a missing `HOVER_INGEST_TOKEN` instead of inviting an infinite poll.

## [0.36.0] — 2026-07-06

### Added

- **mcp:** `test_app` Phase 1 (mapping the business lines from the code) can now fan out across the calling agent's own sub-agents — it's pure code-reading (no browser, no shared state), so on a large app the agent may split the codebase by area, map concurrently, and merge into one map. Called out as the ONLY parallelizable phase; Phase 3 records against a single shared browser and stays strictly sequential. Hover still spawns no agents itself.
- **vscode-ext (0.37.0):** the panel detects whether the current repo is actually a Cloud project (not just git-detected) and offers a one-click **Create project** (opens Cloud's new-project page pre-selected to the repo) when it isn't. See `packages/vscode-ext/CHANGELOG.md`.

### Fixed

- **mcp (0.35.1):** `hover-hook` was a no-op when invoked via its bin symlink (the installed hook path) — the CLI-entry guard compared the symlink path to the realpath. It now compares real paths, so the Claude Code hooks fire.

## [0.35.0] — 2026-07-05

### Added

- **mcp:** `hover-hook` — a second bin that wires Hover into Claude Code's hooks so its deterministic checks run inside the agent loop (no AI). Subcommands: `session-start` injects Cloud + active-environment orientation (identity, project, env URL, drifted specs) as context so the agent starts oriented; `user-prompt` nudges `/mcp__hover__guard` when a prompt looks like new behavior; `stop` surfaces `.hover/` lint at end of turn; `install` merges all three into `.claude/settings.json` idempotently. Enable with `hover-hook install`.

## [0.34.0] — 2026-07-05

### Added

- **mcp:** `cloud_context` tool — one-call orientation for a signed-in agent: who it's connected as, whether this repo is a Cloud project (org + environments with URLs + accounts), and which environment is active in the editor (what a drive/heal targets). Backed by the new `fetchMe` (`GET /api/v1/me`).
- **core:** `fetchMe` + `CloudMe`; `envUrl` on `CloudHealRequest.run` and `CloudRunResult.run` — the drifted/run environment's base URL, joined server-side, so a heal/build targets the right deployment without a second call. `cloud_failures` now surfaces the environment + URL per drifted spec and tells the agent to activate it before healing.

## [0.33.0] — 2026-07-05

**Guard-first development — define the behavior, ship the code, keep the regression.**

### Added

- **mcp:** `/mcp__hover__guard <intent>` — declare a guard BEFORE implementation: interviews the ambiguous edges, records the intent as line-anchored business rules (`record_fact`), and writes a pending `- [ ]` line + acceptance criteria onto the business map via the new `declare_guard` tool. Declarative red, recorded green — no fabricated Playwright; the executable spec is still crystallized from the real flow later, so record == replay holds.
- **mcp:** `/mcp__hover__build <line>` — drive a declared guard to green: implement → verify each acceptance criterion in the live app (grounded tools) → `crystallize_spec` → run the full local regression → push → poll Hover Cloud's per-spec verdicts → dispatch (bug → fix the code; drift → heal the outdated spec; weak-judge unclear → stop and escalate to the human). Budgeted (~10 inner / ~3 CI rounds); never weakens an assertion to pass; merging stays human.
- **mcp:** `cloud_run_result` tool — one ingested CI run + what each failure means (status, drift/bug/unclear verdict, advisory judge score + rationale), polling Cloud's new `/api/v1/runs`. Repo auto-detected from the git origin (`detectRepo`).
- **core:** `declareGuard` (deterministic map writer for pending guard lines — idempotent, tail-section aware, never flips `[x]` back) + `fetchRunResult` / `detectRepo` in the cloud client.


## [0.32.0] — 2026-07-04

### Added

- **core/mcp:** environment-aware Cloud client + an active-environment marker. `fetchDashboard` takes an `env` filter and `DashboardData` carries the project's environment list; `fetchProjects` / `CloudProject` expose each project's environments (name+URL) and accounts (label+env) — names/URLs only, never secrets. New `.hover/active.json` marker via the light `@hover-dev/core/activeEnv` subpath: the editor records the active environment, and the MCP reads it so a drive/heal targets that env's URL instead of a fixed `HOVER_TARGET`, plus loads `.hover/.env` for `HOVER_<LABEL>_USER/PASS` login.
- **vscode-ext (0.33–0.36):** the sidebar is now a single environment-aware panel (Overview / Heal / Environments / Map) with optional (local-first) sign-in, a two-step first-run setup wizard, per-environment scope for the Remote view + heal queue, a read-only mirror of Cloud-managed environments, MCP-targets-the-active-env wiring, and Undo on environment/account delete. See `packages/vscode-ext/CHANGELOG.md`.

## [0.31.0] — 2026-07-04

### Added

- **core:** `ensureKnowledgeTracked(devRoot)` — keeps the repo's `.gitignore` set up to COMMIT the knowledge base (`.hover/hover-map.md`, `.hover/memory/`, `.hover/log.md`) while ignoring working files (sidecars, runs, cache, `.env`). It rewrites a bare `.hover` blanket-ignore into the `.hover/*` + `!` exceptions form git actually honors (a bare `.hover` makes git skip the dir, so subdir re-includes and a nested `.hover/.gitignore` don't work). Called best-effort whenever Hover writes memory (`writeFact`) or the run log (`appendWikiLog`) — idempotent via a sentinel, never throws, opt out with `HOVER_NO_GITIGNORE=1`. Makes Hover Cloud's business-rules-on-the-map + knowledge timeline work for a fresh repo without hand-editing `.gitignore`.

## [0.30.0] — 2026-07-04

### Added

- **core / mcp:** business rules can now be anchored to a business line. `record_fact` takes an optional `line` (the line's name as in `.hover/hover-map.md`); `BusinessFact` carries it through frontmatter (`line:`), and the `test_app` prompt instructs the agent to set it for line-specific rules and leave it blank for app-wide ones. This lets a map view hang each rule under its line and lets drift analysis weigh a recent rule change against a failure. Backward compatible — existing facts (no `line`) load unchanged.

## [0.29.0] — 2026-07-03

### Changed

- **mcp:** business elicitation is now an active checkpoint, not an exception path. On a bootstrap `test_app` run the agent presents the drafted business map and asks — in one message — for priorities, invisible rules (roles/paywalls/safe-environment), and corrections, seeding `.hover/memory/` via `record_fact`. During coverage it records rules the app itself demonstrates (a /login redirect, a quota message) without asking, and batches ambiguous "bug or by-design?" confirmations at natural pauses. Previously the agent only asked when "genuinely unable to resolve" something — which a strong model never is, so the knowledge base never accumulated.

## [0.28.0] — 2026-07-03

**Hover Cloud integration — the editor/MCP side of the cloud ↔ editor loop.**

### Added

- **core:** a Hover Cloud client (`@hover-dev/core/cloud`) — a credentials chain (`HOVER_CLOUD_TOKEN` env → `~/.hover/credentials.json`, `0600`, shared by the extension *and* the MCP), `fetchHealRequests` / `updateHealRequest`, `fetchDashboard` (the shared `DashboardData` contract, so an editor surface reads Cloud runs with the same UI it uses for local `.hover/runs`), and device-link helpers (`startDeviceLink` / `claimDeviceLink`) for browser-approved sign-in.
- **mcp:** `cloud_failures` tool — pulls the Cloud heal queue so the agent can work a drifted spec from the failure hint Cloud extracted.
- **ci:** an opt-in Hover Cloud reporter step in the generated workflow — POSTs `hover-results.json` to Cloud with an environment tag, after the specs run. Execution stays entirely in the user's Actions.

### Changed

- **env:** test accounts simplified to label + email + password.

_(Extension device-link sign-in shipped as `hover-dev` 0.32.0 — see the extension changelog.)_

## [0.26.0] — 2026-07-02

**Self-heal in CI + the Hover Cloud pull channel.**

### Added

- **core / mcp / vscode-ext:** the Hover Cloud **pull channel** (#169) — nothing in the cloud can reach an editor, so the extension and MCP poll the cloud heal queue and surface drift; the fix stays the existing local, human-reviewed hand-off. A queue entry closes only when CI sees the spec pass again.
- **vscode-ext:** **self-heal mode B** (#165) — the generated CI can dispatch a drift-heal back to the editor (B1) and, opt-in, open a Claude auto-heal PR (B2).
- **vscode-ext:** strengthened the generated CI (#168) — sharding, scheduled monitoring, concurrency, and a run summary.
- **mcp:** `optimize-all` + one-command promote + `HOVER_LANG` (converse in your language) (#167).

## [0.24.0] — 2026-07-02

**LLM-Wiki — test knowledge that compounds.**

### Added

- **mcp:** the living test wiki — business-map relationships / inter-line edges (P2, #162), a run-history log at `.hover/log.md` (P3, #161), ask-the-wiki via a `/ask` prompt (P4, #163), and a state-aware `test_app` prompt that distinguishes bootstrap vs. extend with `recall_fact` + lint (#160).
- **vscode-ext:** render the wiki in the Business Map — relationships, lint, and log (#164).

## [0.23.0] — 2026-07-01

### Added

- **mcp:** progressive recall — index-first business memory + `recall_fact` (#159).
- **mcp:** wiki lint (P1) — a `lint_map` tool + `/lint` prompt (#158).
- **mcp:** agent-driven optimize (F7) — a `/optimize` prompt + `save_optimized_spec` (#157).

## [0.22.0] — 2026-07-01

### Added

- **core + mcp:** Page Object extraction — detect shared flows across specs → ask → lift into Page Objects and fold the specs onto them (#154).

## [0.21.0] — 2026-07-01

### Added

- **core + mcp:** open-box-run + auth — dogfood-driven crystallization fixes on a real project (#153).

### Docs

- Documented API testing, self-heal, Page Objects, and auth (shipped v0.19–0.22) (#155); SEO blog posts for the same (#156).

## [0.20.0] — 2026-06-18

### Added

- **vscode-ext:** auto-save — a finished run crystallizes automatically (gated by `hover.autoSaveSpec`), named from the prompt, overwriting the same file on re-run.
- **api-test:** specs split by API resource module into per-module files (and a per-run folder); a save with no explicit checks falls back to deriving regression checks from the run's captured API flows (`deriveRunChecks`).
- **core:** a `mark_flow` control tool — the agent marks each feature it tests, and `writeSpec` splits the run into per-feature spec files (flat, slug == filename).

### Changed

- **vscode-ext:** all webviews (chat, Settings, Dashboard, Conversations, Network) follow the active VS Code theme via `--vscode-*` tokens; the mint accent is retuned for light themes. Fixed hardcoded-dark hover/focus states that rendered as dark blocks on light themes.
- **vscode-ext:** tightened the chat layout — input / message column / header sit tight to the panel edges (max-width centering kicks in only on very wide panels); the stream folds repeated source-exploration steps into one expandable summary; the mode-colour tint is scoped to the input area; removed the "New session" caret; the Local / Cloud tab switcher has a clearer selected state and no longer shifts width on switch.
- **api-test:** the prompt no longer forbids `browser_navigate` to API URLs — direct browsing is captured and crystallized too; `api_request` stays preferred for explicit assertions.

## [0.19.2] — 2026-06-18

### Changed

- **vscode-ext:** responsive chat toolbar — below 280px the browser / mode buttons and the app-status collapse to icon-only (tooltips kept) and the model name truncates instead of overflowing the panel edge. Trimmed the composer's edge padding.

## [0.19.1] — 2026-06-18

### Changed

- **vscode-ext:** redesigned the chat empty state — an ambient-glow sparkle, a gradient "Hover" wordmark, a refined tagline, and three clickable example-prompt chips that prefill the composer. Staggered entrance + gentle idle motion (breathing glow / float / shimmer), gated behind `prefers-reduced-motion`.

## [0.19.0] — 2026-06-18

### Added

- **vscode-ext:** model settings are now a **Local CLI ↔ BYOK** tab switch.
  - *Local CLI* renders detected coding-agent CLIs as selectable cards (Recommended / soft-sandbox badges, inline Local-LLM endpoint), an **Installable** list with copy-paste install hints, and a **Rescan** button (new `refresh-agents` engine message that re-scans PATH).
  - *BYOK* — pick a protocol (Anthropic / OpenAI / Azure OpenAI / Gemini) or an OpenAI-compatible gateway (Ollama Cloud / SenseAudio / AIHubMix); supply key + base URL + model. The key lives in VS Code SecretStorage (per protocol).
- **core:** new `set-byok` / `refresh-agents` WS messages. When BYOK is active, a run is driven by the protocol's matching CLI (anthropic→claude, gemini→gemini, openai/azure/gateway→codex) with the key + base URL injected via env (`ANTHROPIC_*` / `OPENAI_*` / `GEMINI_*`) and the BYOK model id overriding the run model.

## [0.18.2] — 2026-06-18

### Fixed

- **vscode-ext:** the chat stream and `ask_user` prompt now render the agent's Markdown (`**bold**`, `` `code` ``) instead of showing raw `**` / `` ` `` characters. Narration, the question, options, and the answer line all run through the inline renderer (HTML-escaped first, so no XSS).

## [0.18.1] — 2026-06-18

Fixes for API-testing found dogfooding on a real API project (under Claude).

### Fixed

- **API-testing / pentest MCP tools were denied under the Claude hard sandbox.** The flows MCP server used a namespaced id (`@hover-dev/api-test:flows`) whose sanitized allow-list prefix never matched the tool names Claude derives (it keeps the id verbatim), so `api_request` / `replay_flow` / `list_flows` were all blocked — the agent silently fell back to driving the docs UI. The ids are now alphanumeric (`hoverapitest` / `hoverpentest`), and `HoverPluginMcpServer.id` documents the constraint.
- **Soft-sandbox agents (codex) self-restricted to Playwright** and refused the plugin tools — their `developer_instructions` now enumerate the active mode's allowed-tool prefixes instead of hardcoding "playwright only".
- **Save routed by the live mode, not the run's mode** — switching modes after a run could send its save to the wrong writer. Each result carries its run's mode; the Save button binds to it.
- **API checks accumulated across runs in a session** — a save / `.hover/cache/api` record now scopes to the run you saved (new `hover:run:start` boundary), matching the frontend's per-run behaviour.

### Changed

- The `ask_user` / save popup width matches the input box (was wider — it had escaped to the viewport edge).
- Removed the api-test / pentest running-border colour tint (the mode pill already shows the mode).

## [0.18.0] — 2026-06-18

Theme: **API testing is request-first.** The 🟠 API-testing mode tests endpoints by issuing requests directly, and crystallizes to a pure `request.*` spec — never UI clicks.

### Added

- **`api_request` MCP tool** (`@hover-dev/api-test`) — issue a request directly to the app under test (`api_request(method, url, headers?, body?, intent?, expectStatus?)`). For an API-only backend (or one exposing only interactive docs — Swagger / Scalar / Redoc) the agent calls endpoints here instead of driving the docs UI. Origin-locked like `replay_flow` (cross-origin needs `allowCrossOrigin`); auto-carries the session cookie from a same-origin captured flow. `intent` + `expectStatus` record a check.
- **`.hover/cache/api/<session>.json`** — every run's full API traffic + recorded checks, persisted via a new `hover:run:end` plugin hook and bound to the session-ledger id. Lives under `cache/` (always git-ignored) because it holds raw auth/bodies.

### Changed

- **API-testing saves a request-based spec.** The after-run Save (now a button on the Done block, mode-aware) routes API-testing → the request-writer (`writeSecuritySpec` → `request.*` + `expect`), not the browser-step writer. An API test is UI-independent.
- **Pentest** mode is request-aware too: the agent chooses to drive the real UI or call the API directly (`api_request`); same prompt reframe.
- **Prompts** request-first across both modes; agent narration stays in the user's language even while troubleshooting.
- **Cleaner chat stream** — read-only / navigation ops (snapshot, screenshot, scroll, Escape) are kept out of the visible stream (the full record stays in the sidecar). The `ask_user` free-text answer is an always-present inline row (pencil + input + send) instead of an "Other" option that expands.
- Activity Bar panel renamed **Hover Testing** (was "Hover Chat").
- Internal: the api-test MCP server / log prefix `hover-security` → `hover-api-test` (env vars unchanged).

## [0.17.0] — 2026-06-17

Theme: **the chat stream, redesigned.** The run view is now a clean linear "thread" — like Claude Code — instead of collapsible step boxes.

### Changed

- **Linear thread chat stream.** Each AI decision is a node on a continuous left rail; the browser actions it triggers hang off the same rail as one-line, plain-language steps (`Clicked "Sign in"`, `Filled email → …`, `Navigated to /checkout`) instead of raw multi-line MCP JSON. The current action types out with a caret; nodes carry real per-thought time + token meta. No folding, no boxes.
- **Result + findings merged into one plain block** (no cards) — a ✓ outcome, the summary, inline findings, a dim meta footer.
- **Agent reporting prompt tightened (all modes):** keep interim narration to one short line of intent; the final report is exactly one fenced JSON block whose `summary` is formatted as Markdown (a lead line + bullets), with no duplicated prose. Cuts tokens and keeps the stream clean.

### Added

- **After-run save prompt.** The "Save as spec" button is gone; when a run finishes Hover asks — in the composer's place — whether to save and for a filename, warning when the agent flagged issues (the spec records the flow as passing). The ask/ save popups are mutually exclusive with the input and aligned to it.
- **Copy buttons** on the Done summary and each finding (monochrome icon → ✓ on success).
- The agent's `ask_user` answer now renders as a concise threaded node (`You answered: …`) instead of a lingering card.

## [0.16.0] — 2026-06-17

Theme: **Hover is now a VS Code extension — on the Marketplace.** The editor extension (`hover-dev`) is the surface — chat, the Specs / Sessions / Environments views, and the whole engine run inside the editor, nothing else to install. (Published on the VS Code Marketplace as `hyperyond.hover-dev`.) The orange mode is renamed **API testing** and now covers both API/contract testing and security/authz testing; findings render from structured data; and the legacy model-API-key + in-page-widget code paths are gone. The npm bundler-plugin packages (`vite-plugin-hover`, `@hover-dev/astro` / `nuxt` / `next`, `webpack-plugin-hover`, `@hover-dev/cli`, `@hover-dev/widget-bootstrap`, `@hover-dev/transform-source`) and the in-page widget have been **removed** from the repo — previously published versions stay on the registry as historical artifacts. `@hover-dev/core` keeps evolving as the extension's engine (consumed as local source, packed into the .vsix).

### Added

- **VS Code extension (`hover-dev`).** One extension for AI test authoring + application-security testing: a chat webview drives your real Chrome and crystallizes verified flows into plain `@playwright/test` specs; native Specs / Sessions / Environments tree views; a Settings panel. The engine ships inside the extension (spawned under VS Code's Node), so there's no bundler plugin to install.
- **Test-account vault + `@account` mentions.** Define test accounts per environment; reference one as `@label` in chat and the agent logs in with it. Credentials are parameterized into `process.env.HOVER_<LABEL>_*` references on save / re-record — never written into the spec, the JSDoc header, or the `.hover/` sidecar. Account passwords live in SecretStorage; the roster (`.hover/environments.json`) is commit-worthy. One-click export of the env-var names + values to a `.env` or the clipboard for CI secrets.
- **Environments view.** Local + configured remote targets; the active environment drives the run target URL (remote targets skip the dev-server spawn). DNS-verification + cloud sync are present as disabled placeholders for a future Hover Cloud.
- **Security (🟠) / Pentest (🔴) modes** as a mode switch in the one extension, with a mode-colored running border.
- **Add CI Workflow.** Generates a `.github/workflows/hover-e2e.yml` that runs the crystallized specs on every PR — deterministic, no AI — wiring the account secrets by the same `HOVER_<LABEL>_*` names.
- **Optimize auto-opens the candidate diff**, with a live spinner + watchdog; folder-grouped Specs tree.
- **Structured findings.** The agent ends a run with a fenced ` ```json ` block (`{ summary, findings: [{ severity, title, detail, endpoint?, method? }] }`); the chat renders the Findings card from that data instead of scraping Markdown. All modes.
- **Network view.** A live MITM flow inspector (method / URL / status / mutated marker) in 🟠 API-testing and 🔴 Pentest modes.
- **Specs folded into the Dashboard view** (spec × run health matrix + the spec list in one place).

### Changed

- **Distribution is the VS Code extension.** The npm bundler-plugin packages + in-page widget have been removed from the repo; `@hover-dev/core` remains as the extension's engine.
- **Orange mode renamed Security → "API testing".** It covers BOTH functional/contract API testing AND security/authz testing (access control, IDOR/BOLA). The package `@hover-dev/security` → `@hover-dev/api-test`, the crystallized artifact `.security.spec.ts` → `.api-test.spec.ts`, the mode id, the CI release tag, and the docs/site (with 301 redirects from the old `/docs/features/security` routes) all moved with it. Confirmed authz findings still crystallize to a plain Playwright regression spec.

### Removed

- **Model-API-key feature.** The `set-api-key` message, the Settings API-key field, and the whole `apiKey` / `apiKeyEnv` injection path are gone. Coding agents authenticate via their own logged-in subscription (or a key already in the environment); the Local LLM endpoint reads `OPENAI_API_KEY` from the ambient env with a `local` fallback.
- **Dead in-page-widget plugin path** (`widget.js` / `window.__HOVER_WIDGET__` / the `widgetEntry` + `widgetEventTypes` manifest fields) — superseded by the extension's own webview UI — plus a sweep of dead code and a pruned WebSocket protocol.

### Fixed

- **Specs row height no longer jumps on hover** in the Dashboard (the hover-revealed action buttons used to grow the row).

## [0.15.0] — 2026-06-07

Theme: **structured spec output + CLI mode**. The deterministic translator now emits Page Objects, `test.step` stages, and `Promise.all`-paired popup/upload/download flows; an off-by-default AI pass can polish a spec further; and the whole workflow is drivable from the terminal — no widget required.

### Added

- **Structured spec output.** Crystallized specs wrap each step in a named `test.step` (Given/When/Then) and persist a `.hover/<slug>.json` sidecar of the captured session. `hover extract` lifts flows shared across 3+ specs into Page Objects + a single `fixtures.ts`. Popup / new-tab / file-upload / download flows are emitted as `Promise.all([...])` pairings so the event listener can't race the action.
- **AI optimization pass (off by default).** `hover optimize <spec>` (and a widget Actions entry) runs an optional LLM pass that proposes an improved spec as a diff-reviewed **candidate** under `.hover/optimized/` — the original is always kept. Steps it can't translate deterministically are flagged with `// KNOWN BUG` / `hover:optimizable:` rather than dropped. A project-level `optimize` mode (`off` / `suggest` / `on`) controls whether the suggestion surfaces automatically.
- **Seed library.** `.hover/rules/*.json` worked examples feed the optimization pass as few-shot guidance; the widget gains a read-only **Seeds** tab listing what Hover sees. The full seed catalogue ships built-in (no separate repo to clone).
- **CLI mode — `hover run "<prompt>"`.** Author a spec entirely from the terminal: no widget, no DOM injection. Auto-launches the isolated debug Chrome, drives it over CDP, streams the run, and (with `--save <slug>`) crystallizes it. Needs only `@hover-dev/core` — no bundler config.
- **Optional model API key.** A key set in the widget (or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) is injected into the spawned CLI's env. Held in browser localStorage + service memory only — never logged, persisted, or uploaded.
- **`hover-cli` Claude skill** under `skills/` — teaches Claude Code the full CLI, install through crystallize.
- **Prompt-scoped exploration** — the agent's exploration depth is gated on how specific the prompt is.

### Changed

- **`hover add` → `hover setup`.** `add` still works as a deprecated alias (prints a notice).
- **One CLI frame.** `setup` / `run` / `optimize` / `extract` / `re-record` all render the same Clack-style vertical-connector output (`◇ title → │ lines → ◆ result → ╰─ hint`).
- **Sandbox tightened.** Playwright MCP's arbitrary-JS tools (`browser_run_code_unsafe` / `browser_evaluate`) are denied — they punch through the MCP-only sandbox and don't translate to a deterministic spec.
- **Landing-page hero** now demonstrates the optimization pass (naive draft → `Promise.all` pairing) for download / file-upload / OAuth-popup flows.

### Removed

- **Save-as-Skill** is retired. Reloading a spec + `Re-record` + the seed library cover what it did; the widget overlay is now Specs + Seeds.

### Fixed

- **`Skill` tool leaked into the sandbox.** Claude's `Skill` tool loads independently of the `--allowedTools` allow-list; it's now denied, so a run no longer burns a turn "checking for a project skill" or pollutes the spec with a junk `When · Skill` step.
- **`hover run --cwd` in monorepos.** `resolveMcpConfig` now resolves `@playwright/mcp` from the run's `cwd`, not the directory the CLI was invoked from.

## [0.14.0] — 2026-05-31

Theme: **single-Chrome security + a real landing site**. Security mode no longer needs a second browser, the marketing site lands, and the widget gains a plugin-mode theming system.

### Added

- **Landing site (`@hover-dev/site`)** — a static-export Next 16 + React 19 + Tailwind v4 marketing page for gethover.dev, kept separate from the VitePress `docs/`. Design tokens and the four-point ✨ mark are lifted from the widget so the page and the in-app product read as one. The hero embeds an auto-playing **dual-mode** WidgetDemo (Default mint → Security orange) and a click-to-copy install command.
- **`hover:service:start` plugin hook** — fires once at service start, before the debug Chrome launches, so a plugin can boot a sidecar and set Chrome launch flags (e.g. a resident proxy) for the single Chrome.
- **`--mode-accent` widget theming** — when a plugin mode is engaged, `:host(.mode-engaged)` re-points `--accent` (+ `-dim`/`-hover`/`-ink`) at the mode's colour, retinting the Send button, running-step spinner, status dot, and tooltip in one place. Security mode reads orange.
- **Agent output language mirroring** — when the user's prompt contains CJK, the agent writes its prose (verification summary, `## Findings`, step narration) in Simplified Chinese, mirroring how Voice mode already picks a Chinese TTS voice. Prose only — selectors, role names, and the app's own UI text are untouched. English prompts are unaffected.

### Changed

- **Single-Chrome security model.** The MITM proxy is now **resident**: it starts at service start (transparent passthrough by default), and the one debug Chrome on the normal CDP port is born with `--proxy-server` + the SPKI pin. Entering Security mode flips the proxy to intercept — **no second Chrome on 9333, no relaunch**. Trade-off: with `@hover-dev/security` installed, that Chrome is always proxied (transparently) even in normal mode. Projects without the plugin are unaffected.
- **Chrome auto-launch moved into the core service** (out of all five bundler shims) via new `startService` options `autoLaunchChrome` + `devUrl`, since only the service knows the resident proxy port. Also fixes auto-launch having bypassed the service entirely.
- Connection status renders as a single coloured dot + word (`● ready`) instead of a background pill; the mode bar shows the active mode's `engagedHint` (e.g. "MITM proxy active").
- Security plugin UI re-pointed at the core widget's design tokens instead of a private slate palette; pending flows show the rotating spinner.

### Fixed

- **Plugin overlay close button threw `ReferenceError`** — the `×` handler called a bare `closeOverlay`, which only exists as a method on the host `api` object, so the security Network panel could never be dismissed. Calls `api.closeOverlay` now.
- **Security MCP server exited `failed`** — `mcpEnvOverrides` (carrying `HOVER_SECURITY_API`) was cleared on every mode change; it and the resident proxy are now session-resident, so the spawned MCP server always has its env.
- Friendlier CDP-not-found hint (points at the widget ✨ launcher rather than a 9222-only command).

## [0.13.0] — 2026-05-30

Theme: **record/replay parity**. Three closely-related improvements to how saved specs behave under realistic conditions — UI drift, missing initial navigation, and dirty page state at record time.

### Added

- **Visibility prelude in `writeSpec` emit** — every interaction step (`click` / `dblclick` / `hover` / `fill` / `selectOption`) is now wrapped in a block-scoped `{ const el = …; await expect(el).toBeVisible(); await el.<action>; }`. Closes a known gap in role-based locators that an external contributor pointed out on X: `getByRole` defaults to "visible OR attached", so a button that drifted into a closed `<details>` / kebab menu / drawer is still in the role tree, and the locator stays green while the actual flow degraded. Playwright's actionability still eventually caught the case via timeout, but with a generic "element not actionable" message after 30 s; the prelude makes the same case fail in ~3 s with a categorically clear `Locator expected to be visible`. `page.goto` / `page.keyboard.press` are page-level and remain one-liners. New FAQ entry "My button is still in the DOM but moved behind a kebab menu — does the spec catch that?" explains the failure modes the prelude does and doesn't cover (still does NOT cover: silently `disabled` buttons, intermediate-step deletions from the flow).
- **Visibility-drift lab** in `examples/basic-app` — a reproducible scene (URL `?drift=on`) with three buttons hidden three different idiomatic ways (closed `<details>`, `display: none`, `visibility: hidden`). Paired specs `__vibe_tests__/visibility-prelude.spec.ts` (NEW emit) and `visibility-prelude-old-emit.spec.ts` (pre-v0.13 emit) demonstrate the speed + clarity gap side by side.
- **9 new vitest cases** in `packages/core/tests/specs/writeSpec.test.ts` covering the prelude — one per element-targeting tool (`browser_click`/`_double_click`/`_hover`/`_type`/`_select_option`), plus three negative cases (no prelude for `browser_navigate` or `browser_press_key`, multi-field forms emit one prelude per field, chained interactions don't collide on the `const el` declaration).
- **"Reload before recording" setting** (default off) in the widget Settings overlay. When enabled, pressing Record shows a `confirm()` dialog; on OK the page reloads via `sessionStorage` flag and the widget auto-resumes into recording mode. Closes the symmetric gap to the goto fix below: replay always starts from a fresh page load (because `page.goto` is the first step), but a recording captured from a page with accumulated state (logged-in, filled forms) can't be reproduced from that fresh load. Users who want strict record/replay parity flip the switch; the default stays off because the common "I logged in, now record the post-login flow" case shouldn't force re-login. Cancel on the confirm aborts recording entirely (the user opted into the stricter mode; "no, don't reload" means "I need to think," not "record anyway from dirty state").

### Fixed

- **Record mode emits `page.goto` as the first step** — pressing Record now captures `window.location.href` as a synthetic `browser_navigate` step, so the saved spec opens the right page before replaying clicks. Without this, a fresh Playwright run started on `about:blank`, `getByRole(...)` resolved to nothing, and the first interaction timed out with `element(s) not found` — looked like a Hover bug, was really a missing initial `goto`. Agent-driven sessions never hit this because the agent calls `browser_navigate` itself; only manual Record needed the synthetic step.

## [0.12.0] — 2026-05-29

The "security spec recording" release. Closes the security-testing loop opened in v0.7: when `@hover-dev/security` is active, the agent's `replay_flow` MCP tool now records replays as security checks (when given `intent` + `expectStatus`), and the widget's Save-as menu gains a **Security spec** entry that crystallises those checks into `__vibe_tests__/<slug>.security.spec.ts`. CI runs the spec without MITM, without the agent. Also adds two plugin extension points (`saveHandlers` server-side + `saveEntries` widget-side) that any plugin can use to register a custom save flow.

### Added

- **`replay_flow` records security checks** — the MCP tool gains two optional parameters, `intent` (one-line human description of what's being probed, e.g. `"IDOR: access another user's order"`) and `expectStatus` (the HTTP status that proves the security control works, e.g. `403`). When both are passed, the control plane records a `SecurityCheckStep` (source flow id, replay id, intent, expected vs observed status, body excerpt, matched flag). Checks accumulate in-process; the widget mirrors them via a new `security:check:recorded` broadcast.
- **`/checks` HTTP endpoint** on `@hover-dev/security`'s control plane (`GET` returns the recorded list, `DELETE` clears it). `DELETE /flows` now also clears checks since they reference flow ids.
- **`writeSecuritySpec`** (`packages/security/src/writeSecuritySpec.ts`) — turns a `SecurityCheckStep[]` into `__vibe_tests__/<slug>.security.spec.ts`. Plain `@playwright/test` using the `request` fixture, one `test()` per recorded check, asserting `response.status()` and (for 4xx expectations) a coarse PII-leak guard on body length. The JSDoc header always emits an `⚠ Authentication: …` TODO pointing at the FAQ for the `storageState` recipe.
- **`HoverPluginManifest.saveHandlers`** (server-side plugin API) — `Array<{ type, label, description?, activeInModes?, handle(ctx) }>`. The service routes incoming `save:<type>` WS messages to the matching plugin handler. Each plugin owns its own write semantics — payload shape isn't forced through core's `SkillStep[]` pipeline.
- **`WidgetPluginSpec.saveEntries`** (widget-side plugin spec) — `Array<{ type, label, sub?, fields?, confirmLabel?, successMsgTemplate? }>`. The Save-as dropdown queries the active plugin's entries via the host's new `getActiveSaveEntries()` method and appends them. New `saveAsPluginArtifact` runner + `pendingPluginSaves` map mirror the existing core-save flow but route on the plugin-owned WS type (`save:<plugin>:<kind>`).
- **`@hover-dev/security` Save dropdown integration** — manifest registers `save:security:spec` handler; widget plugin registers the matching `saveEntries[0]`. When security mode is active, the Save-as menu shows a "Security spec" item. Form fields: name (required), description, summary.
- **`docs/features/security-spec.md`** — feature page with the full when/why/caveats walkthrough.
- **FAQ entry** "Security spec auth setup" in both READMEs + `docs/faq.md` — the `storageState` recipe for CI auth.
- **`packages/security/tests/writeSecuritySpec.test.ts`** — 17 vitest cases covering: refuses empty checks / non-alphanumeric names, writes to the correct path, throws SecuritySpecExistsError, overwrite=true behaviour, Original prompt + Outcome emission, Checks block summarisation, Findings only-when-vulnerable rule, always-emit auth TODO, Playwright method mapping (GET/POST/PATCH → method; OPTIONS → fetch fallback), expectStatus assertion, PII-leak guard (only for 4xx + body excerpt present), quote / `*/` escaping, long-prompt truncation.

### Changed

- **MCP `replay_flow` response Markdown** now appends a recorded-check confirmation when intent + expectStatus were supplied: `🔒 Security check recorded (#N): <intent>` followed by either `✓ Control is in place` (matched) or `✗ Potential vulnerability` (mismatched, with a hint to Save as Security spec).
- **Roadmap reshuffled.** v0.12 ✓ shipped; Chrome extension stays as the v0.13+ / sibling-repo target.

### Internal

- The widget's onmessage chain now routes `<type>:saved` and plugin-related `error` messages through `tryHandlePluginSave` BEFORE the existing skill/spec/csv handlers, so plugin saves don't trigger `setRunning(false)` or other lifecycle side effects.
- Validation: `pnpm typecheck` clean across all 10 publishable packages; `pnpm --filter @hover-dev/core test` 176 pass; `pnpm --filter @hover-dev/security test` 17 pass; `pnpm test:e2e` 5 Playwright tests pass on `examples/basic-app`.

## [0.11.0] — 2026-05-29

The "spec resilience" release. Hover's central trade-off vs. Stagehand / Midscene has always been: we ship deterministic Playwright specs that run in CI without AI tokens, but those specs are brittle when the UI changes enough to break semantic selectors. v0.11 closes the loop with a **⟳ Re-record** workflow — read the spec's existing `Original prompt:` JSDoc header, replay it against the current UI, and overwrite the file with new selectors. Two entry points: the widget's new Saved-sessions overlay (Skills + Specs tabs), and a new `pnpm hover re-record <spec>` CLI subcommand. Plus a top-level FAQ in the README and docs site explaining the model.

### Added

- **⟳ Re-record from the widget.** New **📜 Saved sessions** overlay (replaces the old single-purpose Saved-skills overlay). Two tabs: **Skills** (existing list of `.claude/skills/<slug>/SKILL.md` entries) and **Specs** (new list of `__vibe_tests__/<slug>.spec.ts` files under `devRoot`). Each Spec row carries a **⟳ Re-record** button that fires the same WS `command` shape with a new `reRecord: { slug }` field — the service collects tool_use events, and on a clean `session_end` overwrites the spec via `writeSpec({ overwrite: true })`. Hand-authored specs (no `Original prompt:` header) list but show a disabled Re-record button with a tooltip explaining why.
- **`pnpm hover re-record <spec>` CLI subcommand** (`packages/cli/src/re-record.ts`, ~250 lines). Boots a temporary `@hover-dev/core` service, parses the spec's JSDoc header locally for fail-fast UX, sends the prompt with `reRecord: { slug }`, prints the resulting `git diff`, and tells you the accept/reject commands. Flags: `--dry-run` (run the agent without overwriting), `--cwd` (target a monorepo workspace), `--port` (override service port; auto-bumps). Picks up `HOVER_AGENT` / `HOVER_MODEL` / `HOVER_CDP` env vars like `pnpm smoke`. Uses Node 22+'s `globalThis.WebSocket` so the CLI doesn't drag in `ws` as a dep.
- **`listSpecs` + `parseSpecHeader` library** in `@hover-dev/core` (`packages/core/src/specs/listSpecs.ts`, 145 lines + 13 vitest cases). Lists every `*.spec.ts` under `__vibe_tests__/` newest-first by mtime, with the parsed JSDoc header (`Original prompt:`, `Outcome:`, `Steps:`, `Expected:`) attached. Tolerant of: missing JSDoc (hand-authored specs), reordered sections, long prompts that wrap, JSDoc comments that appear after the first `test(` (ignored).
- **Service-side `reRecord` support** in the `command` handler. When `payload.reRecord.slug` is set, the service accumulates a `SkillStep[]` from streamed `tool_use` events (mirroring what the widget does), then on a clean `session_end` calls `writeSpec({ overwrite: true, name: slug, steps })`. The service publishes `spec-saved` to confirm; errors surface as `error` messages. Cancelled or errored runs do **not** overwrite the original spec.
- **WS protocol additions** documented in `service.ts`:
  - `client → server` `list-specs` — ask for the current spec list.
  - `server → client` `specs-list { specs: SpecSummary[] }` — response.
  - `client → server` `command { ..., reRecord?: { slug } }` — replay-and-overwrite intent.
- **FAQ section in the README + docs site.** Top-level questions: "My UI changed and my saved spec breaks — what now?", "What's the difference between a Skill and a Spec?", "Will Hover spawn another headless Chromium?", "Does Hover send my source code to a hosted service?", "Why doesn't the widget show up in production builds?". The first question is the load-bearing one — it answers the most-asked X / GitHub comment about AI-authored e2e tests.
- **`docs/features/re-record.md`** — full walkthrough of the feature (when to use, how it works, both entry points, flags, caveats).
- **Updated `docs/features/save-as-spec.md`** — replaced the placeholder with the full spec-format reference, including the selector strategy and the link to Re-record for when selectors do break.

### Changed

- **Widget Skills overlay → Saved sessions overlay.** Same button in the header (📚 icon kept for visual continuity), same WS-driven loading, but now tabbed: Skills (default) and Specs. Per-tab hint paragraphs make the distinction explicit ("Skills self-adapt to UI changes; Specs need re-recording when selectors break"). Tab counts in the header chip update on every list refresh.
- **Roadmap reshuffled.** v0.11 ✓ Spec resilience. v0.12 (was v0.11) → Security mode recording semantics. v0.13 (was v0.12) → Chrome extension. "Re-record `--failed` / `--all`" added as a Beyond entry.

### Internal

- The widget's `state.flows` plumbing from v0.9 stays untouched — Specs tab is its own state path.
- The CLI re-record's local JSDoc parser is a deliberate duplicate of `parseSpecHeader` in `@hover-dev/core/specs/listSpecs.ts` (single regex match). Keeps the CLI's cold-start path light — no dynamic import of @hover-dev/core just to read 3 lines.
- `pnpm typecheck` clean across all 10 publishable packages.
- `pnpm --filter @hover-dev/core test`: 176 tests pass (163 prior + 13 new for `parseSpecHeader` / `listSpecs`).
- `pnpm test:e2e`: 5 Playwright tests pass on `examples/basic-app` (no widget UI regressions from the overlay rewrite).

## [0.10.0] — 2026-05-29

The "multi-tab agent reliability + more agents" release. Hardens the cross-origin / popup-checkout / OAuth-redirect path that v0.7-v0.9 left wobbly — the agent now has explicit system-prompt rules for `browser_tabs(list/select)`, post-`window.close` refocus, and the postMessage handoff back to the original tab. The `examples/payment-provider` sandbox upgrades from a one-button approve/decline to a realistic two-step card + OTP flow with simulated 3DS latency, and a new `pnpm bench-multi-tab` benchmark scores the full end-to-end run across N iterations. Plus `aider`, `gemini-cli`, and `qwen-code` join the agent registry — six supported agents now.

### Added

- **Multi-tab system-prompt addendum** in `packages/core/src/service/cdpHint.ts`. Three new explicit rules teaching the agent to: (5) handle popup-opening clicks by listing tabs, selecting the popup, and refocusing the opener after it closes; (6) follow OAuth-style redirect chains where the same tab index changes origin underneath the agent; (7) handle cross-origin cookie / session updates without forcing a same-origin reload (rule #2 still applies — wait for the postMessage handler instead).
- **`pnpm bench-multi-tab`** — new benchmark script (`packages/core/src/scripts/bench-multi-tab.ts`, 200 lines). Runs N iterations of the full e-commerce → PayHover checkout flow, reports success rate, median wall time, median turns, median cost. Companion to `pnpm bench-ttfb`. Exits non-zero only when ALL runs fail (partial-pass exits 0 to keep signal flowing across branches).
- **`aider` agent in the registry** (`packages/core/src/agents/aider.ts`, 242 lines). Soft sandbox, ⚠ in the dropdown. Install: `pipx install aider-chat`. Stream is plain-text only (aider doesn't ship structured tool-call events), and aider has no MCP integration today — so picking aider from the Hover dropdown gets you an LLM chat with no browser-driving ability. The file header marks this prominently as a degraded mode.
- **`gemini-cli` agent in the registry** (`packages/core/src/agents/gemini.ts`, 336 lines). Soft sandbox. Install: `npm install -g @google/gemini-cli`. Real `--output-format stream-json` with documented `init / message / tool_use / tool_result / error / result` event types. MCP support via `~/.gemini/settings.json` (not per-invocation `--mcp-config`). Per-invocation system-prompt override isn't possible (no CLI flag — only `GEMINI_SYSTEM_MD` env-var pointing at a markdown file), so the HOVER-mode preface prepends to the user prompt.
- **`qwen-code` agent in the registry** (`packages/core/src/agents/qwen.ts`, 329 lines). Soft sandbox. Install: `npm install -g @qwen-code/qwen-code@latest`. `--output-format stream-json` with an Anthropic Messages-style envelope (`tool_use` in assistant content blocks, `tool_result` in user content blocks). Crucially has a real `--append-system-prompt` flag — the cleanest of the four soft-sandbox descriptors. Also exposes `--max-wall-time` / `--max-tool-calls` / `--max-session-turns` budget caps (not USD-denominated; not surfaced by default).
- **3 new vitest suites** (aider/gemini/qwen) — +53 tests on top of the prior 110, total 163.
- **`examples/payment-provider` two-step flow.** Step 1: card number (16-digit `4242 4242 4242 4242`) + CVV (3 or 4 digits) → Continue with simulated 600ms 3DS pre-check. Step 2: 6-digit OTP (always `123456` in the sandbox) → Confirm → postMessage + `window.close()` after 1.5s. Decline button on each step short-circuits to the same `payment-result: declined` path. New `data-testid` selectors on every interactive control (`card-number`, `cvv`, `continue`, `otp`, `confirm`, `decline`) so e2e specs and benches can target them deterministically.

### Changed

- **Roadmap reshuffled.** v0.10 now reflects the multi-tab + agent-registry work that's shipped here. v0.11 keeps its "security recording semantics" target. **Chrome extension moved from v0.10 to v0.12+ (or a sibling repo)** — Web Store releases are manual and the extension's cadence shouldn't gate on monorepo PRs.
- **`examples/payment-provider` CSS** gained card-form / OTP-form input styles + a disabled-button style. No host-app changes — same postMessage shape, same return origin allow-list.
- **README + README.zh-CN** updated to reflect six supported agents (was three).

### Internal

- Roadmap subsections in `docs/reference/roadmap.md` and zh-CN counterparts updated alongside this release.
- The widget plugin-UI protocol (v0.9) means no widget changes were needed for this release — all the multi-tab work is prompt + bench + example.

## [0.9.0] — 2026-05-29

The "widget plugin-UI protocol" release. Plugins can now contribute their own widget surface (CSS, toolbar buttons, overlays, WS message handlers, lifecycle callbacks) via a new `window.__HOVER_WIDGET__` host API — not just server-side mode / MCP / prompt contributions. `@hover-dev/security` migrates off the hardcoded `client.js` branches that v0.7 added; default mode and plugin modes now share a symmetric protocol where each side owns its own widgets. Bonus: `cursor-agent` joins the agent registry alongside `claude` + `codex`.

### Added

- **Widget plugin-UI contribution protocol.** New `widgetEntry?: string` field on `HoverPluginManifest` — plugins point at a JS module that the bundle assembler inlines after the widget core. New widget host module (`packages/widget-bootstrap/src/widget/host.js`, 449 lines) exposes `window.__HOVER_WIDGET__` with `registerPlugin / getState / setState / openOverlay / closeOverlay / send`. Six contribution surfaces — namespaced CSS (auto-prefixed with `[data-plugin-active="<name>"]`), declarative DOM mutations (`hide` / `addClass`, reverted on deactivate), toolbar buttons, overlays, WS message handlers, and `onActivate` / `onDeactivate` callbacks. Single-mode exclusivity invariant: at most one plugin's contributions are visible at any time; default mode equals "no plugin active." All callbacks wrapped in try/catch with `[hover/plugin "<name>"] <where> failed:` structured logging — a plugin crashing never blocks the WS pump or other plugins.
- **Symmetric mode-ownership model.** Default mode owns its own widgets (`Record`, `Fix`, etc.) and listens for `modes` payload changes to hide/show them itself; plugin modes own their contributed widgets. Neither side reaches into the other's DOM. Plugins never need to know default-mode selectors — adding a new plugin no longer requires listing "what core buttons should I hide."
- **`@hover-dev/security` widget plugin module** (`packages/security/src/widget.js`, 187 lines). Network panel, flow row rendering, orange theme, status code colour buckets, mutated highlight — all contributed via the new host API. Security plugin ships its widget surface alongside its server-side manifest; the npm tarball includes `dist/widget.js` (copied from `src/widget.js` at build time — `widget.js` is authored as plain JS, not TS).
- **`cursor-agent` joins the agent registry** (`packages/core/src/agents/cursor.ts`, 351 lines). Soft sandbox (⚠ in the dropdown, same as codex). Stream-JSON / NDJSON parser handles Cursor's `system / user / assistant / tool_call / result` events with defensive walking of the `*ToolCall` wrapper variants. Known limits surfaced in the descriptor's docstring: no `--max-budget-usd`, no `--mcp-config` (users add the Playwright MCP to `~/.cursor/mcp.json` themselves), no token/cost data in the stream (widget renders `–` for cursor sessions). Install hint: `curl https://cursor.com/install -fsS | bash`. 18 new vitest cases.

### Changed

- **`@hover-dev/astro`, `@hover-dev/nuxt`, `webpack-plugin-hover` accept plugins.** Previously only `vite-plugin-hover` and `@hover-dev/next` did. `hover()` / `new HoverPlugin()` gain a `...plugins: HoverPluginManifest[]` varargs slot (Nuxt uses `plugins?: HoverPluginManifest[]` in its module options since `defineNuxtModule` setup can't take varargs). Older `hover({})` calls without plugins continue to work unchanged.
- **Generic `.plugin-overlay` shell** in the widget CSS replaces the security-specific `.network-overlay` rules. Plugin overlays now share the same slide-over animation, header, and overlay-offset behaviour without each plugin having to bring its own positioning CSS.
- **Catch-all `[hidden] { display: none !important }`** in the widget CSS. Several existing widget elements had to repeat `.foo[hidden] { display: none }` per selector to defeat author `display: flex` / `display: inline-flex` declarations — fragile, easy to forget. One generic rule now covers every widget element (including plugin-contributed DOM), so `el.hidden = true` reliably collapses anything.
- **Fix popover gets the `.panel.has-modebar` 68px offset.** Pre-existing layout bug — the popover sat at `top: 48px` and overlapped the 28px mode bar when one was present. Fixed; tooltips from header buttons under the popover are also now suppressed (mouseover handler short-circuits when `.fix-popover.visible` or any `.plugin-overlay.open` element exists).

### Removed

- **`client.js` security-specific hardcoded branches.** `state.flows`, the 7 `networkXxx` DOM handles, `renderFlowRow`, `renderNetworkOverlay`, `upsertFlow`, the `security:flow:added` / `:updated` WS branch, the `networkBtn.hidden = !engaged` + `recordBtn.hidden = engaged` lines in `renderModeButton`, and the security-specific CSS (`.network-overlay`, `.flow-row`, `.flow-status-*`, etc.) — all moved into `@hover-dev/security`'s widget module or replaced by the generic plugin-overlay shell. `client.js` shrank from 3337 to ~3155 lines.

### Internal

- **5 commits squashed into 1 merge commit (PR #49).** Net diff +1,196 / −319.
- Plugin-host Playwright spec (`examples/basic-app/__vibe_tests__/plugin-host.spec.ts`) — 3 deterministic checks: `__HOVER_PLUGINS__` preamble carries security's descriptor, `__HOVER_WIDGET__` host API exposed on window with `apiVersion: 1`, default mode renders zero plugin contributions when security is installed but inactive.
- Agent worktree branch `worktree-agent-af9f4b3f0c47da73a` was a side-effect of the cursor-agent task isolation — has no unique commits; safe to ignore.

## [0.8.0] — 2026-05-29

The "multi-framework source attribution" release. The v0.4.x JSX stamp generalises to four frameworks (JSX / Vue / Svelte / Astro) through a new private workspace package, plus `@hover-dev/next` gains first-class plugin support so `@hover-dev/security` and future third-party plugins wire into Next without dragging Node-only deps into the Edge bundle.

### Added

- **Multi-framework source attribution.** The v0.4.x `data-hover-source="<file>:<line>:<col>"` stamp now covers four file shapes, one transform per framework, all reporting the `<` character's 1-indexed line + column for cross-framework consistency:
  - `.jsx` / `.tsx` — Babel parser (covers React / Solid / Preact). Unchanged from v0.4.x.
  - `.vue` — `@vue/compiler-sfc`, filters via `tagType === ELEMENT_TYPE_HOST` so PascalCase and kebab-case components are skipped.
  - `.svelte` — `svelte/compiler`'s `parse({ modern: true })`, gates on `type === 'RegularElement'` so `Component` / `SvelteHead` / `TitleElement` are skipped.
  - `.astro` — `@astrojs/compiler` (async because the underlying parser is WASM-backed), filters via `type === 'element'` so PascalCase components AND kebab-case custom-elements are both skipped.
- **`@hover-dev/transform-source` — private workspace package.** Owns all four per-framework transforms (`transformJsx` / `transformVue` / `transformSvelte` / `transformAstro`). Marked `private: true` and never published to npm. **Distributed by inlining**: each of the 5 integration shims (vite / astro / nuxt / next / webpack) runs `tsup` with `noExternal: ['@hover-dev/transform-source']`, so the transform code lands inside the shim's own `dist/` and the published bundle has no bare `@hover-dev/transform-source` import. Transform-source's npm-side deps (`@babel/*`, `@vue/compiler-sfc`, `svelte`, `@astrojs/compiler`, `magic-string`) get promoted into each shim's `dependencies` so they resolve normally at install time.
- **Per-shim transform dispatch by extension.** Each integration's `transform` hook now dispatches on file extension: `.jsx`/`.tsx` → JSX, `.vue` → Vue SFC, `.svelte` → Svelte 5, `.astro` → Astro. `vite-plugin-hover`, `@hover-dev/astro`, `@hover-dev/nuxt`, `@hover-dev/next` (via Turbopack `turbopack.rules['*.{jsx,tsx}']`), and `webpack-plugin-hover` (via a `module.rules` loader) all go through the same code path.
- **Astro `.astro` files intercept at `load()`, not `transform()`.** Astro's internal `astro:build` Vite plugin does the SFC compile in its `load()` step, so by the time user `transform()` hooks see the file it's already-compiled JS. The Astro integration now reads the raw file from disk in `load()`, runs `transformAstro` (parse → mutate AST → serialise round-trip via `@astrojs/compiler`), and returns stamped source. `.jsx`/`.tsx`/`.vue`/`.svelte` continue through `transform()` because they don't have an upstream `load()` step.
- **`@hover-dev/next` plugins via `register()` second argument.** Plugins like `@hover-dev/security` are now wired into Next projects by passing a `PluginSpec[]` to `register()` in `instrumentation.ts` — either a bare module-specifier string `'@hover-dev/security'` or an `{ module, options }` object. Vite / Astro / Nuxt / Webpack continue to accept plugins as additional arguments to `hover()` / `new HoverPlugin()`; Next is the outlier because Next compiles `instrumentation.ts` for both the Node and Edge runtimes and a top-level import would drag plugin packages' Node-only deps (mockttp, playwright-core) into the Edge bundle. Specifiers are resolved at runtime inside `@hover-dev/next/internal/register-node` via a `new Function('s','return import(s)')` opaque dynamic import — Turbopack's static tracer can't follow it, so plugin code stays strictly Node-runtime-only. `examples/next-app/instrumentation.ts` and `examples/turbo-monorepo/apps/web/instrumentation.ts` are the reference shapes.
- **`packages/next-integration/README.md`.** Brings `@hover-dev/next` in line with the other four integration packages, each of which already shipped a README on npm.

### Fixed

- **`@hover-dev/next` `register-node` resolves from `.next/server` (Next 15).** v0.7.4 fix. Next 15's runtime layout puts `instrumentation.js` in a deeper `.next/server` subtree, so the prior `import.meta.url`-relative resolution of `register-node.js` missed the file. The resolver now walks for `register-node.js` from a known stable anchor.
- **Plugin-spec resolver walks `node_modules` from `process.cwd()`, not from the integration package.** Earlier prototype used `createRequire(...).resolve('<plugin>')`, but plugin packages' `exports` maps don't declare a `require` condition (their npm publish is ESM-only), so the CJS resolver errored with "No exports main defined". The resolver now walks up from the user's project root looking for `node_modules/<plugin>/package.json`, reads `exports['.']{import}` / `module` / `main` itself, and loads the resulting absolute path via a `file://` dynamic import. Sidesteps both monorepo hoisting surprises and conditional-exports edge cases. Verified in `examples/next-app` (flat) and `examples/turbo-monorepo/apps/web` (monorepo).

### Documentation

- **`autoLaunchChrome` clarified.** Docs now state explicitly that `autoLaunchChrome` spawns the isolated debug Chrome under `<tmpdir>/hover-chrome` (not the user's primary Chrome profile).
- **Docs site nav version resolves from the git tag at build time.** The version pill in the docs site nav is no longer hand-edited per release — it reads from the latest git tag during the docs build.

## [0.5.0] — 2026-05-26

Two big additions land together: a **Suggest fix prompt** button that copies a precise source-attribution prompt into the user's coding agent, and a **Record + Assert merge** that consolidates the two separate workflows into one sub-toolbar. Plus seven release-audit fixes including one critical monorepo dev-mode unblock.

### Added

- **Suggest fix prompt (footer ⌖ Fix button).** Click Fix → click any host-page element → type what you'd like to change → ⌘↵. Hover assembles a fact-only prompt — source `file:line:col`, ancestor source chain (catches styled-components / wrapper-rendered hosts), React component chain, Playwright selector, outer HTML — and writes it to the clipboard, ready to paste into Cursor / Claude Code / Windsurf. The prompt has zero leading instructions — agent gets pure context and the user's intent as a markdown blockquote. Verified end-to-end on five wrapper shapes (bare host, styled-components, className-forwarding, multi-layer nested, Radix Slot/asChild) in `examples/basic-app/src/wrapper-lab.tsx`.
- **`data-hover-source` Vite transform.** Stamps `data-hover-source="<file>:<line>:<col>"` on every host JSX element in user code. React 19 compatible — runs `enforce: 'pre'` so it sees JSX before `@vitejs/plugin-react` collapses it. Serve-only no-op in production. Toggle via the new `sourceAttribution` plugin option (default true). 11 vitest tests; covers JSX/TSX, lowercase tag filtering, ancestor preservation, TypeScript generics, fragments, syntax errors, and Windows path normalisation.
- **Record + Assert merged into one sub-toolbar.** Toggle Record in the footer, then switch between four mutually-exclusive modes via the new sub-toolbar above the textarea: **● Record** (records the click as a Playwright step — the default), **✓ Exists** (`expect(SEL).toBeVisible()`), **¶ Says** (`toHaveText("…")`), **= Equals** (`toHaveValue("…")` / `toBeChecked()` for checkboxes). Check sub-modes are one-shot — after the click commits the assertion, the toolbar snaps back to Record. Pattern follows Playwright codegen's five-button toolbar. The hidden ⌥click=assert chord is **removed** — its functionality moves into the Record session itself.
- **First-use hint above the sub-toolbar.** "Click on the page to record what you do, or switch to a check below." Shown once per browser via `localStorage['hover:sub-toolbar-hint-seen']`, then suppressed.
- **Pause-during-Fix.** Clicking Fix mid-recording is now allowed. Capture pauses while the popover is open (a new `recordingPaused` flag short-circuits all four capture handlers); recording auto-resumes when Fix closes (Submit or Cancel). The Record button is disabled while Fix is open so you can't accidentally end the paused session.
- **Wrapper-attribution lab.** New `examples/basic-app/src/wrapper-lab.tsx` exercises five wrapper patterns side-by-side. The file-header comments document the measured behaviour for each (which gets a precise stamp, which falls back to ancestor chain, which falls back to `_debugOwner` name).

### Changed

- **Sub-toolbar labels are plain English, not Playwright jargon.** Earlier internal-API-derived labels (`Action / Visible / Text / Value`) confused users who hadn't used Playwright codegen. Now: `Record / Exists / Says / Equals`. Each has a plain-English tooltip explaining what the check actually checks. User-visible strings throughout — Done card summary, post-action toast, picker overlay badge — say "check" instead of "assertion".
- **Footer Send button is right-aligned.** The right-pusher span was removed when the sub-toolbar took over the old `⌥click assert` hint; Send drifted left and hugged Fix. One-line CSS fix (`margin-left: auto`).
- **Done card summary uses per-session check count.** Previously read from the workspace-wide `state.assertions.length`, so a second consecutive recording would report the first session's still-unsaved checks. The Done card now reports only the delta since the current session started; unsaved checks still bake into the eventual Save as Spec.

### Fixed

- **Release-blocker: `pnpm dev` / `pnpm test:e2e` were broken in the monorepo since v0.4.x.** `vite-plugin/src/index.ts` imported `./source-attribution.js`, but the file on disk was `.ts` and `vite-plugin-hover` ships in src-entry shape in the monorepo (`main: src/index.ts`). Vite's esbuild externalises workspace dependencies when bundling the user's `vite.config.ts`, so Node's strict ESM resolver tried to find a literal `.js` next to `index.ts` and failed. Local PRs passed only because Playwright's `reuseExistingServer` reused stale Vite instances from prior sessions. **End users on npm-installed `vite-plugin-hover` were unaffected** (their `publishConfig.main: dist/index.js` had a sibling `dist/source-attribution.js`), but anyone doing fresh `git clone && pnpm install && pnpm dev:example:basic-app` hit `ERR_MODULE_NOT_FOUND`. Fix: inline the source-attribution transform directly into `index.ts`.
- **Host-page clicks while the Fix popover is open no longer silently re-target it.** Previously a stray click would overwrite the user's typed intent and swap the element preview. Now the click handler returns early when the popover is visible; Cancel / Esc / ⌘↵ is the only path out.
- **`flashElement` no longer orphans the mint outline.** Back-to-back flashes on the same element used to leave a permanent green ring if the second flash's snapshot caught the first flash's transient style. WeakMap-tracked original style + single in-flight timer means re-entry reuses the first snapshot and resets the timer.
- **`recordingPaused` flag is always cleared on `setRecording(false)`.** Defensive cleanup — happy path through enter/exit Fix is fine, but HMR re-init or programmatic stop paths could orphan the flag, suppressing all capture in the next Record session.
- **Recording interrupted by page reload no longer leaks into the next session.** `loadState` now detects a `(recording manual interactions)` user message with no matching done card after it, and synthesizes a "Recorded N actions before reload" done card so the survived steps are still saveable instead of getting swept into whatever runs next.
- **Esc keyup handler structured for mutual exclusion.** `fixMode` and `assert-*` sub-modes can't actually coexist via the UI, but the previous structure (two consecutive `if`s with no return) made it look like both branches could fire on a single Esc. Restructured as if-fixMode-return-else-if.

### Removed

- **⌥click=assert chord.** Its functionality is now reached via Record's `✓ Exists / ¶ Says / = Equals` sub-modes. The chord was discoverable only via a footer hint and had no equivalent in any other test-recording tool (Playwright codegen, Cypress Studio, Selenium IDE all use a toolbar mode or right-click) — folding it into Record drops the hidden modifier-key surface and produces the same data shape downstream.

### Internal

- 7 new PRs (#27-#33) merged into main. Last release was v0.3.4; this release skips v0.4.x as a separate tag because v0.4.x (`Suggest fix prompt`) and v0.5.x A (`Record + Assert merge`) were merged in the same dev cycle and the README / roadmap now describe them together. CHANGELOG entry rolls them up.

## [0.3.3] — 2026-05-25

A perf pass on the LLM hot path plus a round of UX fixes that came out of dogfooding the result.

### Fixed

- **Group status now reflects business outcome, not tool retries.** Previously, a single MCP tool call that returned `is_error: true` painted the entire group red ✗ even when the agent recovered with a retry and the step actually succeeded. Real-world example: 3 of 4 steps showed red on a run that had in fact completed cleanly — the agent had simply retried a stale `ref=...` selector inside each step. Now `step.isError` is preserved on individual tool entries (still rendered in the expanded view for diagnostics), but only the session-level `done.isError` paints the group red.
- **User-pressed-Stop renders as "Stopped", not "Failed".** Previously the cancel path emitted `session_end { isError: true, summary: 'cancelled by user' }`, so the widget rendered a red ✗ "Failed" card — treating the user's own action as a system failure. The terminal state now has three rendered-distinctly cases: ✓ green Result (agent completed) · ✗ red Failed (agent / runtime error) · ⊘ grey Stopped (user pressed Stop). A cancelled run is also no longer marked `saveable` — it's not a complete spec.
- **The agent now knows its standing mission.** A user typing "test" got a single `browser_snapshot` and a one-line "App is running fine" report. The system prompt covered navigation rules and narration format but never stated what the agent is actually here to do. New "Your job" preamble in `buildCdpHint` defines the standing mission: drive the app, exercise interactive surfaces, report bugs. Vague prompts ("test", "check", "find bugs") trigger a real exploratory test pass (snapshot → identify surfaces → drive 2–5 flows → note findings) instead of a one-shot status report. Specific prompts ("log in and add a todo") are still followed verbatim.
- **Result card no longer drops the prose summary written inside a `## Findings` block.** `extractFindings` only kept the `## Findings` list items and threw the rest of the block — plus anything after the next heading — away. Agents writing structured findings mixed with prose paragraphs (the common shape, especially after the mission preamble landed) saw their narrative summary silently vanish. The reducer now stitches `beforeBlock` + non-list-item lines from inside the block + `afterBlock` back together as `rest`; only the actual list items get extracted into `findings[]`.
- **Next.js integration: MCP server now connects under Turbopack.** `resolveMcpConfig` used `import.meta.url` as the base for resolving `@playwright/mcp/cli.js`, but Next 16's Turbopack rewrites that to a `[project]/...` virtual URL, which `createRequire` then propagated into the generated mcp.config.json. Claude Code couldn't load the resulting path and reported `mcp_status: failed`; the agent fell back to non-browser tools. Resolution now starts from `process.cwd()`, which is a real disk path under every consumer (Vite / Astro / Nuxt / Webpack worked too, just by accident).

### Performance

Three wins on the LLM-driven loop's hot path; ~1 s (median ~16%) shaved off the time-to-first-`tool_use` on a cold command, and 93% trimmed off the system-prompt addendum on every follow-up turn. Came out of a post-v0.3.2 latency audit. End-to-end benchmark at [`packages/core/src/scripts/bench-ttfb.ts`](https://github.com/Hyperyond/Hover/blob/v0.3.3/packages/core/src/scripts/bench-ttfb.ts) (run via `pnpm bench-ttfb`).

- **Pinned MCP server path.** Was: `mcp.config.json` ran `npx -y @playwright/mcp@latest` on every `claude -p` spawn — registry round-trip + tarball metadata + node boot before the MCP server could start (2.4-6.0 s in isolation). Now: `@playwright/mcp` is a direct dep of `@hover-dev/core`, and a new `resolveMcpConfig.ts` resolves `cli.js` via `createRequire(...).resolve()` at service boot and writes a synthetic mcp config to `<tmpdir>/hover/mcp-config-<port>.json` pointing `process.execPath cli.js …` at it.
- **System-prompt addendum split into stable + volatile.** Was: `service.ts` re-appended the full 2.4 KB CDP hint (nav rules + narration format + tab list) every turn via `--append-system-prompt`, fragmenting Anthropic's prompt-cache fingerprint and re-billing ~600 input tokens per follow-up. Now: new `buildCdpHintResume(tabs)` returns just a 175-char tab snapshot; service picks `resumeSessionId ? buildCdpHintResume : buildCdpHint`. 93% size reduction on follow-up turns, fingerprint stays cache-friendly.
- **Shared preflight cache across command + check-cdp paths; 30 s TTL.** Was: service kept a 5 s closure-scoped preflight cache for its own use; `cdpStatus.checkCdpStatus` did a fresh preflight on every widget `check-cdp` ping (which fires on every Vite HMR reconnect). Now: module-scoped `preflightCache.ts`, keyed by cdpUrl, shared by both paths. TTL bumped to 30 s — Chrome's tab list doesn't drift faster.

### Internal

- New `pnpm bench-ttfb` script for A/B-ing perf changes across git branches. Documented in `CLAUDE.md`.

## [0.3.2] — 2026-05-25

Post-release audit fixes for v0.3.1's `@hover-dev/next`. Three real bugs + three code-quality improvements found by sweeping the integration after publish.

### Fixed

- **`@hover-dev/cli` no longer silently bricks `next.config.ts` projects.** Next 16 loads `.ts` configs through a CJS `require()` step that can't resolve `@hover-dev/next`'s ESM-only `exports` map. `mutateNext` previously wrote `withHover(...)` into the `.ts` file anyway, leaving the user with a broken `next dev`. It now detects `.ts` up-front and returns a tailored "rename to `.mjs` and paste this" instruction instead. `configCandidates` priority flipped so `.mjs`/`.js` are tried first.
- **`register-node` single-process guard hardened.** Previously env-var only (`__HOVER_NEXT_RESOLVED_PORT`); now also a module-scoped `didRegister` boolean. Closes the race window where two concurrent `register()` awaits could both pass the env-var check before either had set the resolved port, and survives any Next HMR edge case that re-evaluates the instrumentation module without clearing `process.env`.
- **Root `postinstall` no longer rebuilds on hot installs.** New `scripts/postinstall-build.mjs` walks the `src/` and `dist/` trees of `@hover-dev/core` and `@hover-dev/widget-bootstrap`, compares mtimes, and skips the build when both are fresh. Saves ~5 s on every `pnpm install` / `pnpm add` in CI and contributor workflows.

### Changed

- **`@hover-dev/next` package surface trimmed.** Removed `cross-spawn`, `playwright-core`, `ws` from `dependencies` — they were already transitively pulled in via `@hover-dev/core`, and listing them twice was a documentation lie waiting to drift. The `tsup external` list keeps them as bundle-time externals.
- **`options.ts` boolean deserialisation is now symmetric.** Both `enabled` and `autoLaunchChrome` return `undefined` for unset env keys, `false` for `'0'`, `true` for `'1'`. The previous asymmetry happened to produce correct behaviour by coincidence but read confusingly. New `readBool` / `readNumber` helpers replace the inline conditionals.
- **`tsup.config.ts` comments rewritten to match reality.** Earlier prose described an inlining scheme that didn't actually happen; the real reason for keeping `@hover-dev/widget-bootstrap` and `@hover-dev/core` external (asset relocation + Edge-bundle isolation) is now spelled out clearly.

## [0.3.1] — 2026-05-24

The "Next.js" follow-up to 0.3.0. v0.3.0 covered Vite / Astro / Nuxt / Webpack; this release closes the largest remaining gap with a Turbopack-native Next.js integration.

### Added

- **`@hover-dev/next` — Next.js (App Router, Turbopack) integration.** Three pieces: (a) `withHover(nextConfig, opts)` — pure `next.config.mjs` wrapper, serialises options onto `process.env` so the runtime can recover them across Next's config / build / serve lifecycle boundaries; (b) `<HoverScript />` — Server Component rendered after `{children}` in `app/layout.tsx`, emits an inline `<script type="module">` carrying the widget bundle; (c) `register()` from `@hover-dev/next/instrumentation` — Next's blessed dev-and-runtime hook, boots the Hover service via `startService` from `@hover-dev/core`. Active only when `process.env.NODE_ENV === 'development'` AND `process.env.NEXT_RUNTIME === 'nodejs'` (Edge runtime is unsupported — the service depends on `ws` + `cross-spawn` + `playwright-core`). Edge-bundle isolation uses a string-variable indirection (`const specifier = './register-node.js'; await import(specifier)`) so Turbopack's static tracer leaves the Node-only graph alone.
- **`@hover-dev/cli` knows about Next.** Detection priority places `next` above `webpack` so a Next project routes to `@hover-dev/next` (not the webpack plugin, which only covers `next dev --webpack`). The Next mutator touches two files idempotently: wraps `next.config.{ts,mjs,js}` in `withHover(...)` via magicast, and creates / merges `instrumentation.ts` at the project root (or `src/`). `app/layout.tsx` is deliberately NOT auto-edited — AST-mutating user JSX invites whitespace drift and Server Component shape surprises; the CLI prints the one-liner to paste. `--next` flag added; `--help` updated.
- **`examples/next-app`** — minimal Next 16 App Router dogfood (counter + todos, port 5182). Verifies the three-piece integration end-to-end against `next dev` on default Turbopack.

### Changed

- **`@hover-dev/core` and `@hover-dev/widget-bootstrap` switch to dist-entry shape** (`main: dist/index.js`) and ship a `dev: tsc --watch` script. This is a monorepo-only concession — Turbopack's resolver does not rewrite NodeNext-style `.js` import specifiers back to on-disk `.ts` files inside transitively-traced source packages ([vercel/next.js#82945](https://github.com/vercel/next.js/issues/82945)), so the workspace-symlinked source-mode entry that every other Hover example happily transpiles on-the-fly fails under `next dev`. End users on a published install see no difference (they already get compiled `.js`). When #82945 lands, both packages revert to src-entry; tracking comment lives in `packages/next-integration/src/withHover.ts`.
- **Root `postinstall`** runs `pnpm --filter @hover-dev/core --filter @hover-dev/widget-bootstrap build` after every install. Fresh clones get usable `dist/` artefacts before anyone touches an example.
- **`pnpm dev:example:next-app`** spawns three `concurrently` watchers in parallel (`tsc --watch` for core, `tsc --watch` for widget-bootstrap, `next dev` itself). Edits to `packages/core/src/service.ts` re-emit `packages/core/dist/service.js` in ~500 ms; Next picks up the changed `dist` file and HMRs the page. Cold start ~5 s.
- **README + 中文 README**: bundler-coverage section grew to six targets (added Next.js with `@hover-dev/next`); example count went from 9 to 10; v0.3.x line in the roadmap moves from "planned" to "you are here". CLAUDE.md gained two new sections: package entry-point conventions (explaining the Next-tax) and Edge-runtime isolation in `@hover-dev/next` (explaining the string-variable indirection).

### Internal

- New publishable package: 8 total (`@hover-dev/core`, `@hover-dev/widget-bootstrap`, `@hover-dev/astro`, `@hover-dev/nuxt`, `@hover-dev/next`, `@hover-dev/cli`, `vite-plugin-hover`, `webpack-plugin-hover`). `.github/workflows/publish.yml`'s `PKG_FILTERS` updated to include `@hover-dev/next`; workspace-dep order preserved (`core` + `widget-bootstrap` publish before `next` so the `workspace:*` rewrite resolves correctly).
- `@hover-dev/next` is the first Hover package built with `tsup` (esbuild-based) rather than raw `tsc`. Bundles the package itself; leaves `@hover-dev/core`, `playwright-core`, `react`, `next`, etc. external.

## [0.3.0] — 2026-05-24

The "multi-bundler + one-command setup" release. Hover now covers every major frontend bundler and you wire it in with a single `npx`.

### Added

- **`@hover-dev/cli` — one-command setup.** `npx @hover-dev/cli add` detects your bundler (Vite / Astro / Nuxt / Webpack), reads your lockfile to pick the right package manager (pnpm / yarn / bun / npm), installs the matching Hover package as a dev dep, and AST-edits your config file. Force a specific bundler with `--vite` / `--astro` / `--nuxt` / `--webpack`; preview without changes via `--dry-run`. Idempotent — safe to re-run.
- **`@hover-dev/astro` — Astro integration.** Astro's HTML pipeline for `.astro` pages silently drops user Vite plugins' `transformIndexHtml` output, so dropping `vite-plugin-hover` into `astro.config.mjs`'s `vite.plugins` doesn't fully work. This package wraps the same core service + widget bundle behind Astro's `injectScript('page', ...)` integration API. Active only on `astro dev`.
- **`@hover-dev/nuxt` — Nuxt module.** Nuxt renders HTML through Nitro, not Vite, so `transformIndexHtml` is a no-op for Nuxt SSR responses (nuxt/nuxt#19853). This module uses `@nuxt/kit`'s `defineNuxtModule` and pushes the widget into `nuxt.options.app.head.script` with `tagPosition: 'bodyClose'`, which Nitro renders inline into the SSR'd HTML. Active only when `nuxt.options.dev === true`.
- **`webpack-plugin-hover` — webpack 5 plugin.** Covers vanilla `webpack-dev-server`, Rspack, Rsbuild, plus legacy CRA (via `craco`) and Vue CLI (via `configureWebpack`). Taps `HtmlWebpackPlugin.getHooks(compilation).alterAssetTagGroups` to push a `<script type="module">` into `bodyTags`; falls back to a `processAssets` HTML splice when `html-webpack-plugin` isn't installed. **Does NOT cover Next.js by default** — Next 16 ships Turbopack as the default bundler and Turbopack does not load webpack plugins. Next users on `next dev --webpack` can wire it manually; a Turbopack-native `@hover-dev/next` is on the v0.4 roadmap.
- **`@hover-dev/widget-bootstrap` — host-agnostic widget builder.** Extracted from the previous `vite-plugin-hover` internals so every bundler plugin / integration above produces a byte-identical widget. Three layers: `getWidgetScript()` (Vite-shaped tag descriptor, one-liner inside `transformIndexHtml`), `buildWidgetBundle()` (raw `{ preamble, body }` strings — for Astro `injectScript`, Nuxt `app.head.script`, webpack `alterAssetTagGroups`, or any raw HTTP server), `readWidgetAssets()` (raw mtime-cached bytes — for future plugins that want `Compilation.assets`-style registration).
- **`examples/astro-app`, `examples/nuxt-app`, `examples/webpack-app`, `examples/rn-web-app`** — four new dogfood targets, one per Hover integration package. Each ships the same counter + todo smoke content as `basic-app` for direct cross-target comparison. The rn-web-app demonstrates that React Native Web is in scope (just `react-native` → `react-native-web` Vite alias); React Native **native** (iOS / Android) is explicitly not supported — that space belongs to Maestro / Detox / Appium.

### Changed

- **`vite-plugin-hover` no longer ships its own widget assets.** It now consumes `@hover-dev/widget-bootstrap` for the widget bundle and `@hover-dev/core` for the service. The plugin's source dropped from 225 to 142 lines, all of which is now pure Vite-lifecycle glue. End users importing `import { hover } from 'vite-plugin-hover'` see no change in behaviour; npm pulls `@hover-dev/widget-bootstrap` automatically as a transitive dep. *(Tagged `refactor!:` in the commit log only because someone reaching into `vite-plugin-hover/dist/widget/*` programmatically would have to switch to `@hover-dev/widget-bootstrap/dist/widget/*`. The supported `hover()` plugin API is unchanged.)*
- **Performance pass on the existing service + widget hot paths.** Five fixes in one PR ([details](https://github.com/Hyperyond/Hover/pull/2)): readline + child-process cleanup so caller `break` no longer leaks orphan agent processes; mtime-cached widget file reads in the Vite plugin (was synchronous re-read every page load); `preflightCDP` result cached for 5s so repeat invocations skip the `/json/version` + `/json/list` round-trip; widget `saveState` debounced and `renderAll` rAF-coalesced so a streaming tool_use burst collapses to one DOM rebuild per frame; agent PATH detection parallelised across the registry. Combined effect: lower latency on subsequent commands, lower CPU during long runs, no orphan processes after disconnects.
- **README + 中文 README**: install section now leads with `npx @hover-dev/cli add`; manual `pnpm add -D <pkg>` moved under a `<details>` fold. New "Bundler coverage" subsection in "See it in action". Bottom example table grew from five to nine apps. New "React Native — only the Web target is supported" subsection states the scope explicitly so users don't show up expecting native mobile coverage.
- **Banner image** updated to show `$ npx @hover-dev/cli add` instead of the old `npm install -D vite-plugin-hover` command. Tagline retained.

### Fixed

- `service.close()` errors during dev-server shutdown are now logged instead of silently swallowed.
- `preflightCDP`'s `/json/list` failure path now logs a warning instead of silently returning an empty tab list (which would have produced an empty / incomplete CDP hint in the agent's system prompt).
- `launchDebugChrome` `SingletonLock` cleanup errors are now logged instead of silently swallowed — makes diagnosing a "Chrome won't launch" cascade traceable.
- Several union-type narrowing fixes in `@hover-dev/core` surfaced by the new Astro example's stricter `tsconfig` — pre-existing latent issues, no behaviour change.

### Internal

- New monorepo layout: 7 publishable packages (`@hover-dev/core`, `@hover-dev/widget-bootstrap`, `@hover-dev/astro`, `@hover-dev/nuxt`, `@hover-dev/cli`, `vite-plugin-hover`, `webpack-plugin-hover`) + 9 examples. `pnpm typecheck` and `pnpm test` continue to fan out cleanly across the workspace; 118 unit tests passing.
- `.github/workflows/publish.yml` extended to cover all 7 packages via a single `env.PKG_FILTERS` variable — adding a new package in the future updates one line.

## [0.2.4] — 2026-05-24

### Changed
- **Group meta line now shows duration + per-group cost** instead of step-count. Finished group: `1.1s · $0.0123`. Running group: `1.1s`, ticking once per second (in-place DOM patch — no flicker, no scroll thrash, no re-animation of fresh rows). Per-group cost is computed by diffing the cumulative `runningCost` snapshot stamped on the first vs. last `tool_use` event in the group, so it attributes LLM spend to the natural-language intent that drove those tools rather than dumping a single session-total at the end.
- `InvokeEvent.tool_use` carries a new optional `costUsdSnapshot` field (cumulative session cost at the moment of the tool call). Backwards-compatible: older consumers ignore it; widget falls back to the previous `N steps` meta for groups that predate the wiring (e.g. messages restored from localStorage written by 0.2.3).

### Fixed
- **`mcp/playwright: pending` no longer shown as a permanent stuck state.** Claude Code only reports MCP server status once, at `system/init` — usually "pending" because the handshake hasn't finished. There is no follow-up "connected" event, so the original message hung in the timeline forever even though the MCP was working fine (proof: every subsequent `mcp__playwright__*` tool call succeeded). The widget now silences `pending` and `connected` and only surfaces genuine failure states (`⚠ mcp/<server>: <status>`).

## [0.2.3] — 2026-05-23

### Documentation
- Backfill v0.2.x release notes in CHANGELOG.md (this section). No code changes beyond the docs touch that ships this version.

## [0.2.2] — 2026-05-23

### Added
- **OpenAI Codex CLI support.** Service auto-detects `claude` and `codex` on PATH; the widget header shows the active agent as a pill (`claude ▾`) with a dropdown to switch. Soft-sandbox agents (codex) get a ⚠ badge — codex has no built-in-tool deny list at the CLI level, so we use `--sandbox read-only` + a strict `developer_instructions` system prompt.
- **Widget UI v2** — dark panel (`#1a1a1a`) + mint accent (`#7CFFA8`). Conversation reads as one row per natural-language intent; tool-call details collapsed behind a chevron. Result and bug **Findings** render as dedicated cards instead of being folded into the last step.
- **Custom in-shadow-DOM tooltip** with ~120ms delay and dark/mint theming — replaces native `title=` which rendered laggy and light-themed against the dark panel.

### Changed
- Save-as artifact pipeline now drives all three formats (Playwright spec, Claude Code Skill, Jira test case CSV) through a single config-table dispatcher on both the widget and service sides. ~700 fewer lines of duplicated code, same wire protocol.
- `service.ts` split into focused modules under `packages/core/src/service/` (cdpHandlers, saveHandlers, cdpHint, types). Main file dropped from 749 to 444 lines.
- Parser state (cost, turn count, item-type map, error flag) moved from module-level globals in `claude.ts` / `codex.ts` to a per-invocation `ParserState` object threaded through `parseEvent` / `onStreamEnd` by `invokeAgent`. Two concurrent runs no longer smear their accumulators together.
- Pure widget transforms (`groupMessages` + helpers) extracted into `packages/vite-plugin/src/widget/reducer.js` with 31 new unit tests.

### Fixed
- **Save-as button stuck on "Saving…"** — the post-save re-arm selector still targeted the legacy `.msg.done .actions .save-trigger` from the pre-v2 done-card layout; switched to a defensive `.save-trigger` query so the trigger actually resets.
- Skill tool-call no longer leaks into the user-facing timeline (hidden in the reducer's `HIDDEN_TOOLS` set).
- Tool names in expanded step rows no longer wrap mid-name; only the args column wraps now.
- macOS Switch-to-it focus on launch: after `Page.bringToFront()` we now raise the Chrome process at the OS layer via `osascript` by PID, matching by `--remote-debugging-port` listener so we don't accidentally raise the user's primary Chrome.

## [0.2.1] — 2026-05-23

### Fixed
- **Switch-me-to-it** now actually focuses the debug Chrome window on macOS. CDP's `Page.bringToFront()` only activates the tab inside Chrome — the OS-level window stayed buried. We now also raise the Chrome process at the OS layer (`osascript` by PID on darwin, `wmctrl -ia` on Linux, `AppActivate` on Windows). Best-effort: if the helper is missing the tab is still correctly focused inside Chrome.

## [0.2.0] — 2026-05-22

### Changed (breaking)
- **Package rename.** `@hyperyond/core` → `@hover-dev/core` (scoped, dedicated npm org). `@hyperyond/vite-plugin` → `vite-plugin-hover` (unscoped, follows the `vite-plugin-*` community convention so registry.vite.dev's daily npm scan picks it up).
- Consumers must update imports:
  ```diff
  - import { hover } from '@hyperyond/vite-plugin';
  + import { hover } from 'vite-plugin-hover';
  ```
- GitHub repo (`Hyperyond/Hover`) is unchanged.

## Milestones

- **2026-05-20** — Phase 0 (technical feasibility) verified.  
  `claude -p` sandboxed to only Playwright MCP successfully drove the user's existing Chrome through a multi-step task in `examples/basic-app` (then named `example-frontend`). End-to-end chain proven before any UI was built.

[Unreleased]: https://github.com/Hyperyond/Hover/compare/main...HEAD
