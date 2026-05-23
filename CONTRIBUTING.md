# Contributing to Hover

Hover is a Vite plugin that injects a floating chat widget into your dev server. The developer types a natural-language instruction; an agent (the user's own local `claude` CLI today) drives the user's Chrome via Playwright MCP; the session can be one-click crystallised into a standard `@playwright/test` file.

Read [CLAUDE.md](./CLAUDE.md) first — it is the project's design + boundary brief. This file covers contributor-facing workflow only.

## Prerequisites

- **Node.js 22.x or 24.x**.
- **pnpm 10+**.
- **Google Chrome** (or Chromium / Edge — `scripts/start-chrome.ts` checks several locations across darwin / win32 / linux).
- **`claude` CLI** on `PATH` (Anthropic Claude Code). Other agents (`codex`, `cursor`, `aider`, …) can be added by writing an `AgentDescriptor` and registering it in `packages/core/src/agents/registry.ts` — no other code changes needed.

## Local setup

```bash
git clone https://github.com/Hyperyond/Hover.git
cd Hover
pnpm install
pnpm typecheck       # fans out to every package
```

`pnpm install` runs `husky install` automatically (the `prepare` script). A `commit-msg` hook is installed; see [Commit conventions](#commit-conventions) below.

## Dev workflow

Two things must be running for end-to-end testing. Once Chrome and Vite are up, they stay running across many smoke loops:

```bash
# Terminal 1 — start an example app + the Hover service. Examples in this
# repo pass `autoLaunchChrome: true`, so this ALSO spawns an isolated debug
# Chrome (--remote-debugging-port=9222, profile under <tmpdir>/hover-chrome)
# navigated to the dev URL. Idempotent: reuses an existing debug Chrome if
# 9222 is already alive.
pnpm dev:example:basic-app          # http://localhost:5173 — minimal: login + counter + todos
pnpm dev:example:e-commerce         # http://localhost:5174 — Amazon-style storefront
pnpm dev:example:stock-registration # http://localhost:5175 — IBKR-style account-opening wizard
pnpm dev:example:canvas-paint       # http://localhost:5176 — drawing app + DOM toolbar
pnpm dev:example:payment-provider   # http://localhost:5177 — third-party popup (NO widget)

# Terminal 2 — command-line agent smoke (alternate to using the widget in-browser).
pnpm smoke "test the login flow"
```

Need a debug Chrome without starting any example? `pnpm smoke:chrome` (or `pnpm exec hover-chrome`) spawns one standalone, same profile, idempotent.

The Hover service listens on `127.0.0.1:51789`; the widget connects there over WebSocket.

## Validation harness

Each layer has its own quick check so debugging is layer-by-layer:

| Command | Layer it exercises | Cost |
|---|---|---|
| `pnpm typecheck` | All `tsc --noEmit`. Fastest. | free |
| `pnpm verify-widget` | Playwright DOM checks against the injected widget (host/shadow/launcher/panel toggle). | free |
| `pnpm verify-skill` | Unit test for `writeSkill` — fabricates a session, writes SKILL.md, prints it, cleans up. | free |
| `pnpm ws-smoke "<prompt>"` | Bypasses the browser. Connects to the service over WS, fires a command, prints events. Tests service ↔ agent. | ~$0.05–0.30 |
| `pnpm smoke "<prompt>"` | Bypasses the service. Direct call to `invokeAgent`. Tests agent ↔ Playwright MCP ↔ Chrome. | ~$0.05–0.30 |
| In-browser widget | Full chain through WebSocket. | ~$0.05–0.30 |

If something fails, climb the ladder: typecheck → verify-widget → ws-smoke → smoke → widget.

## Project layout

```
packages/
├── core/                   @hover-dev/core
│   ├── src/agents/         Local CLI Agent First — types, registry, detect, argv, invoke, claude.ts
│   ├── src/playwright/     CDP preflight (lightweight HTTP probe + playwright-core handshake)
│   ├── src/skills/         writeSkill, listSkills (write/read .claude/skills/<slug>/SKILL.md)
│   ├── src/service.ts      WebSocket bridge (widget ↔ agent)
│   ├── src/smoke.ts        Command-line agent smoke
│   └── src/scripts/        start-chrome.ts, ws-smoke.ts, verify-widget.ts, verify-skill.ts, detect-cli.ts
├── vite-plugin/            vite-plugin-hover
│   └── src/index.ts        configureServer (boot service) + transformIndexHtml (inject widget)
│   └── src/widget.js       Vanilla JS Shadow-DOM widget — no React, no transpilation
└── …

examples/                   Each app stands alone, has its own aesthetic + Vite port.
├── basic-app/              5173 — login + counter + todos
├── e-commerce/             5174 — Amazon-style storefront
├── stock-registration/     5175 — IBKR-style wizard
├── canvas-paint/           5176 — drawing app + DOM toolbar
└── payment-provider/       5177 — third-party popup, NO widget
```

## Adding a new agent

The whole point of "Local CLI Agent First" is that a contributor can add a new agent without touching anything else. Steps:

1. Create `packages/core/src/agents/<name>.ts`. Export an `AgentDescriptor`. Implement:
   - `binName` — the executable on `PATH`.
   - `protocol` — `'argv'` (prompt as flag), `'stdin'` (prompt on stdin), or one of the placeholder protocols (`'acp'`, `'pi-rpc'` — these throw today).
   - `streamFormat` — `'stream-json'` / `'sse'` / `'plain-text'` / `'json-lines'`.
   - `buildArgs(opts)` — return the argv array.
   - `parseEvent(line)` — translate one line of stdout into an array of normalised `InvokeEvent` (see `agents/types.ts`).
2. Register it in `packages/core/src/agents/registry.ts`.
3. Run `pnpm detect` to confirm Hover finds your binary; then `pnpm ws-smoke "list the open tabs"` to confirm the end-to-end loop works with your descriptor.

No changes are needed in `service.ts`, the widget, or any example.

## Adding a new example

Each example is a standalone pnpm workspace package. To add one:

```bash
mkdir -p examples/my-example/src
cd examples/my-example
```

Copy `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, and `src/App.tsx` from a peer example (e.g. `examples/basic-app`). Update:

- `package.json` `name` to `my-example`.
- `vite.config.ts` `server.port` to a free port (5178+).
- `index.html` `<title>` to `my-example · Hover`.

The plugin is already pulled in via `vite-plugin-hover: workspace:*` — running `pnpm install` will link it.

Add a root script:

```json
"dev:example:my-example": "cross-env NODE_OPTIONS=\"--import tsx/esm\" pnpm --filter my-example dev"
```

Update [CLAUDE.md](./CLAUDE.md) `## Workspace directories` with a one-line description.

## Visual aesthetics

Each example commits to a distinct visual direction — no two share fonts, palette, or composition. New examples should follow that principle, not converge on generic AI-style "purple gradient on white". Pick a clear aesthetic point of view and execute it with restraint. See `.claude/skills/frontend-design/SKILL.md` for the design brief.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/). Enforced by the husky `commit-msg` hook running `commitlint`.

```
<type>(<scope>): <description>
```

- **type**: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `style`, `revert`.
- **scope**: `core`, `vite-plugin`, `widget`, `examples`, `agents`, `playwright`, `mcp`, `ci`, `deps`, the specific example name (`basic-app`, `e-commerce`, …), or omit if cross-cutting.
- **description**: imperative, ≤72 characters, no trailing period.

Body is optional but encouraged for non-trivial commits — describe *what changed and why*, not the mechanical *how*. Wrap at ~72.

```
feat(core,widget): in-flight cancel + skill name collision handling

Two reliability nits exposed by real use of the Save-as-Skill loop.

Cancel:
- Widget: Send button turns red 'Stop' while running. Click sends
  {type:'cancel'} via WS.
- Service: cancel() aborts the in-flight AbortController and emits a
  synthetic session_end so the widget resets to idle immediately.
...
```

**Do not** use `git add -A` / `git add .` — stage files explicitly by name. **Do not** `--no-verify` or `--amend` someone else's commits. Sign-off and `Co-Authored-By` lines are fine.

## Tests

- **Vitest** for unit tests under `packages/*/tests/`. Currently mostly empty — adding tests is welcome.
- **Playwright** for end-to-end specs under `examples/<x>/__vibe_tests__/`. These are the dogfooded crystallised specs — the shape Hover emits on "save as Playwright spec". They run with `pnpm test:e2e` and do not require the agent in the loop.

For a fresh machine: `pnpm --filter basic-app exec playwright install chromium`.

## Code style

- TypeScript everywhere except the injected widget (plain ES2022 JS for size + no transpilation in dev).
- Strict mode, `noImplicitAny`, etc. — all enabled via `tsconfig.base.json`.
- No formatter committed yet (intentional — pick when it matters).
- File header comments are welcome when the file's purpose is non-obvious; per-line comments only when the *why* is not derivable from the code.
- No emojis in code unless requested.

## Reporting bugs / asking questions

Open a GitHub issue. Please include:

- Reproduction steps in one of the five `examples/` apps if relevant.
- `pnpm typecheck`, `pnpm verify-widget`, and `pnpm ws-smoke "<your prompt>"` output (the cost is pennies and the output is invaluable for triage).
- claude CLI version (`claude --version`), Node version (`node --version`), Chrome version, OS.

Welcome aboard.
