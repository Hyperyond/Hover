# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are ISO 8601, UTC.

All notable changes to Hover are recorded here. Conventional Commits in the git log are the source of truth; this file groups them by user-visible impact.

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

## [Unreleased]

### Added (Phase 2 — spec crystallisation)

- **Save as Playwright spec** (`📜 Save as spec` button beside Save as Skill on every successful done card). Writes a standard `@playwright/test` file to `<devRoot>/__vibe_tests__/<slug>.spec.ts`. The file imports only `@playwright/test`, has no Hover runtime dependency, and uses `getByRole / getByLabel / getByTestId` semantic selectors derived from the agent's natural-language element descriptions. Same overwrite-confirm dance as Save as Skill.
- **"Assert This" Alt-click** — While the widget is open, holding **Alt / ⌥** and clicking any element on the host page intercepts the click and produces a Playwright assertion derived entirely from the element's current state. Assertions accumulate (badge in the header shows count) and ship out with the next Save as Spec, embedded after the action steps with their hint as a `// comment`. Selector priority: `data-testid` → `aria-label` → `role + accessible name` → visible text. Assertion shape: `toBeChecked / toHaveValue / toBeDisabled / toHaveText / toBeVisible` chosen automatically from the element's tag and current state. 900ms green outline flash on the captured target.
- **Recording mode** — `🔴 Record` toggle in the footer. While recording, every manual click / text input / `<select>` change / checkbox toggle on the host page is captured and appended to `state.messages` in the same shape the agent emits. `writeSkill` and `writeSpec` work on recorded sessions without modification — they cannot tell whether the steps came from `claude` or from the user. Text input fills are debounced (flushed on blur or before the next click). Form submits via Enter are caught via a `submit` listener. Recorded sessions get a fabricated "user" message at the start and a synthetic `session_end` at stop, so the action bar's Save buttons appear.

### Added

- **Local CLI Agent First architecture** (`@hover-dev/core/agents`) — Hover bundles no AI runtime. It detects whichever coding-agent CLI the user already has on `PATH` (`claude` today; `codex` / `cursor` / `aider` are one-file additions to the registry) and normalises its output to a single `InvokeEvent` stream.
- **Vite plugin with Shadow-DOM widget** (`vite-plugin-hover`) — `transformIndexHtml` injects a floating launcher + dialog into the dev page on `apply: 'serve'`. Marked with `data-hover="true"` so future Playwright runs can skip it.
- **Long-running WebSocket service** (`@hover-dev/core/service`) — Started by the plugin's `configureServer` hook, bound to `127.0.0.1`. Streams normalised agent events to the widget; accepts `command`, `cancel`, `save-skill`, and `list-skills` messages from it.
- **Session persistence + resume** — Widget messages, session id, and panel open-state survive page reload via `localStorage` (`hover:state:v1`). New commands optionally pass `sessionId` so `claude` resumes the prior conversation via `--resume <uuid>`.
- **In-flight cancel** — The Send button turns red ("Stop") while the agent runs. Cancel aborts the in-flight `AbortController`, kills the spawned `claude` child, and surfaces a synthetic `session_end` to the widget immediately.
- **Save as Claude Code skill** — Save-as-Skill button on every successful done card. Writes `<devRoot>/.claude/skills/<slug>/SKILL.md` (YAML frontmatter + original prompt + numbered tool-call list + outcome). Subsequent natural-language commands like "execute login-as-claude" make the agent auto-discover and replay it.
- **Skills sidebar** — `📚` button opens an overlay listing skills auto-discovered from `<devRoot>/.claude/skills/`. Click a skill to fire `execute the <slug> skill`.
- **Skill name collision handling** — `writeSkill` throws `SkillExistsError` instead of silently overwriting; widget surfaces a confirm-overwrite dialog.
- **CDP preflight** — Service refuses to invoke if `localhost:9222` is unreachable (lightweight HTTP probe of `/json/version` + `/json/list`). Prevents Playwright MCP from falling back to launching its own Chromium.
- **Same-URL navigation hint** — Service injects a per-command `--append-system-prompt` telling the agent not to `browser_navigate` to a URL the user is already on (avoids wasteful full-page reloads).
- **Cross-platform tooling** — `cross-spawn` for `spawn`, `cross-env` for `NODE_OPTIONS`, `scripts/start-chrome.ts` Node-based replacement for the macOS-only bash launcher. Probes Chrome/Chromium locations across darwin / win32 / linux.
- **Five example dev targets** under `examples/`, each with its own deliberate visual aesthetic and `Hover` widget enabled (except `payment-provider`):
  - `basic-app` (5173) — login + counter + todos. Swiss / Bauhaus minimal.
  - `e-commerce` (5174) — Amazon-style storefront, product list → cart → checkout. Refined boutique.
  - `stock-registration` (5175) — IBKR-style 7-step brokerage account opening wizard. Editorial financial publication.
  - `canvas-paint` (5176) — 9-tool drawing app: pencil/eraser/line/rect/ellipse/triangle/text/bucket/eyedropper, opacity, fill-vs-stroke, zoom, image background, recent colors, keyboard shortcuts. Atmospheric studio.
  - `payment-provider` (5177) — mock third-party payment popup for the e-commerce cross-tab flow. **Does not install `vite-plugin-hover`** on purpose — widget must not appear on a simulated third-party origin. Fintech glass.

### Architecture

- Repository is a pnpm workspace (`packages/*`, `examples/*`), ESM throughout, TypeScript with `moduleResolution: Bundler`.
- Three packages: `@hover-dev/core` (agents, service, Playwright preflight, skill IO), `vite-plugin-hover` (injection + service lifecycle), and the example apps.
- Hover service binds to `127.0.0.1` only; widget is in a Shadow DOM with `z-index: 2147483647` so host-page CSS cannot affect it and host-page DOM does not interfere with it.

### Reliability

- `WebSocketServer` `error` listener prevents `EADDRINUSE` from crashing Vite.
- `invokeAgent` accepts an `AbortSignal`; service aborts on `ws.close` so a reloaded dev page does not leave an orphan agent process driving a vanished browser tab.
- `disallowedTools` for the spawned agent: `Bash BashOutput KillBash Edit MultiEdit Write Read NotebookEdit Grep Glob Task TodoWrite WebFetch WebSearch ExitPlanMode`. Combined with `--strict-mcp-config`, `--permission-mode dontAsk`, and `--allowedTools mcp__playwright`, the agent can only reach the user's Chrome via Playwright MCP.
- Per-invocation hard budget `--max-budget-usd 0.50`.

### Tooling

- Husky `commit-msg` hook running `commitlint` (Conventional Commits required).
- Per-package `tsconfig.json` extending root `tsconfig.base.json`; `pnpm typecheck` fans out.
- Smoke harness:
  - `pnpm smoke:chrome` — start an isolated debug Chrome (idempotent, cross-platform).
  - `pnpm smoke` — agent-loop smoke (`detect → preflight → invokeAgent`, prints events).
  - `pnpm ws-smoke` — exercises the WebSocket protocol without a browser.
  - `pnpm verify-widget` — Playwright DOM assertions against the injected widget.
  - `pnpm verify-skill` — unit test for `writeSkill`.

### Documentation

- `CLAUDE.md` is the canonical project guide read first by agents entering the repo.
- `docs/PRD.md` is the product spec (gitignored — owner-only).
- Per-package READMEs in `packages/core/`.

### Removed

- **AI-suggested skill name** (briefly added in `31bc9f5`, removed in `c2f9d89`). The cold-start cost of spawning a second `claude` for a one-line name was ~13–17s on the OAuth path and unacceptable for a "save" affordance. May return as a fast path when `claude --bare` becomes the default mode or when a direct Anthropic SDK call is acceptable.

## Milestones

- **2026-05-20** — Phase 0 (technical feasibility) verified.  
  `claude -p` sandboxed to only Playwright MCP successfully drove the user's existing Chrome through a multi-step task in `examples/basic-app` (then named `example-frontend`). End-to-end chain proven before any UI was built.

[Unreleased]: https://github.com/Hyperyond/Hover/compare/main...HEAD
