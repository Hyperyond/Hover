# Contributing to Hover

Hover is a VS Code extension with a chat panel in the editor. The developer types a natural-language instruction; an agent (the user's own local `claude` / `codex` CLI) drives the user's Chrome via Playwright MCP; the session can be one-click crystallised into a standard `@playwright/test` file.

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

Two things must be running for end-to-end testing: a target dev server and the
sideloaded extension. Once Chrome and the dev server are up, they stay running
across many runs:

```bash
# Terminal 1 — start a target dev server (a plain Vite/Next/etc. app; nothing
# Hover-related is installed in it — the extension drives it over CDP).

# Terminal 2 — build + sideload the extension, then drive the target from its
# chat panel. The extension spawns the isolated debug Chrome on demand
# (--remote-debugging-port=9222, profile under <tmpdir>/hover-chrome).
pnpm --filter hover-dev package     # → hover-dev-<v>.vsix; sideload into VS Code
```

The Hover engine listens on `127.0.0.1` (ports 51789+); the extension's WS client connects there.

## Validation harness

| Command | Layer it exercises | Cost |
|---|---|---|
| `pnpm typecheck` | All `tsc --noEmit`. Fastest. | free |
| `pnpm test` | Vitest unit tests across packages. | free |
| Extension chat panel | Full chain (extension → WS → engine → agent → Playwright MCP → Chrome). | ~$0.05–0.30 |

If something fails, climb the ladder: typecheck → unit tests → sideload the extension and watch the chat panel + engine logs.

## Project layout

```
packages/
├── core/                   @hover-dev/core — the Node engine
│   ├── src/agents/         Local CLI Agent First — types, registry, detect, argv, invoke, claude.ts
│   ├── src/playwright/     CDP preflight (lightweight HTTP probe + playwright-core handshake)
│   ├── src/skills/         writeSkill, listSkills (write/read .claude/skills/<slug>/SKILL.md)
│   └── src/service.ts      WebSocket bridge (extension ↔ agent)
├── probe-engine/           private shared probe engine (security + pentest)
├── api-test/               @hover-dev/api-test — 🟠 API-testing mode plugin
├── pentest/                @hover-dev/pentest — 🔴 pentest mode plugin
└── vscode-ext/             hover-dev — the VS Code extension (primary surface)
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
3. Sideload the extension and confirm your binary shows up in Settings → Local CLI (Rescan if needed), then drive a target app from the chat panel to confirm the end-to-end loop works with your descriptor.

No changes are needed in `service.ts` or the extension.

## Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/). Enforced by the husky `commit-msg` hook running `commitlint`.

```
<type>(<scope>): <description>
```

- **type**: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `style`, `revert`.
- **scope**: `core`, `vscode-ext`, `security`, `pentest`, `probe-engine`, `agents`, `playwright`, `mcp`, `ci`, `deps`, or omit if cross-cutting.
- **description**: imperative, ≤72 characters, no trailing period.

Body is optional but encouraged for non-trivial commits — describe *what changed and why*, not the mechanical *how*. Wrap at ~72.

```
feat(core,vscode-ext): in-flight cancel + skill name collision handling

Two reliability nits exposed by real use of the Save-as-Skill loop.

Cancel:
- Extension: Send button turns red 'Stop' while running. Click sends
  {type:'cancel'} via WS.
- Service: cancel() aborts the in-flight AbortController and emits a
  synthetic session_end so the chat panel resets to idle immediately.
...
```

**Do not** use `git add -A` / `git add .` — stage files explicitly by name. **Do not** `--no-verify` or `--amend` someone else's commits. Sign-off and `Co-Authored-By` lines are fine.

## Tests

- **Vitest** for unit tests under `packages/*/tests/`. Currently mostly empty — adding tests is welcome.
- **Playwright** for end-to-end specs crystallised under a target app's `__vibe_tests__/` — the shape Hover emits on "save as Playwright spec". They run with standard `@playwright/test` and do not require the agent in the loop.

## Code style

- TypeScript everywhere.
- Strict mode, `noImplicitAny`, etc. — all enabled via `tsconfig.base.json`.
- No formatter committed yet (intentional — pick when it matters).
- File header comments are welcome when the file's purpose is non-obvious; per-line comments only when the *why* is not derivable from the code.
- No emojis in code unless requested.

## Reporting bugs / asking questions

Open a GitHub issue. Please include:

- Reproduction steps against a target dev server if relevant.
- `pnpm typecheck` / `pnpm test` output, and a note on what you exercised in the extension chat panel (invaluable for triage).
- claude CLI version (`claude --version`), Node version (`node --version`), Chrome version, OS.

Welcome aboard.
