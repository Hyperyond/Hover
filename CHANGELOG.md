# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are ISO 8601, UTC.

All notable changes to Hover are recorded here. Conventional Commits in the git log are the source of truth; this file groups them by user-visible impact.

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
