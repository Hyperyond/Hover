# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are ISO 8601, UTC.

All notable changes to Hover are recorded here. Conventional Commits in the git log are the source of truth; this file groups them by user-visible impact.

## [Unreleased]

### Added

- **`@hover-dev/next` plugins via `register()` second argument.** Plugins like `@hover-dev/security` are now wired into Next projects by passing a `PluginSpec[]` to `register()` in `instrumentation.ts` — either a bare module-specifier string `'@hover-dev/security'` or an `{ module, options }` object. Vite / Astro / Nuxt / Webpack continue to accept plugins as additional arguments to `hover()` / `new HoverPlugin()`; Next is the outlier because Next compiles `instrumentation.ts` for both the Node and Edge runtimes and a top-level import would drag plugin packages' Node-only deps (mockttp, playwright-core) into the Edge bundle. Specifiers are resolved at runtime inside `@hover-dev/next/internal/register-node` via a `new Function('s','return import(s)')` opaque dynamic import — Turbopack's static tracer can't follow it, so plugin code stays strictly Node-runtime-only. `examples/next-app/instrumentation.ts` and `examples/turbo-monorepo/apps/web/instrumentation.ts` are the reference shapes.
- **`packages/next-integration/README.md`.** Brings `@hover-dev/next` in line with the other four integration packages, each of which already shipped a README on npm.

### Fixed

- **Plugin-spec resolver walks `node_modules` from `process.cwd()`, not from the integration package.** Earlier prototype used `createRequire(...).resolve('<plugin>')`, but plugin packages' `exports` maps don't declare a `require` condition (their npm publish is ESM-only), so the CJS resolver errored with "No exports main defined". The resolver now walks up from the user's project root looking for `node_modules/<plugin>/package.json`, reads `exports['.']{import}` / `module` / `main` itself, and loads the resulting absolute path via a `file://` dynamic import. Sidesteps both monorepo hoisting surprises and conditional-exports edge cases. Verified in `examples/next-app` (flat) and `examples/turbo-monorepo/apps/web` (monorepo).

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
