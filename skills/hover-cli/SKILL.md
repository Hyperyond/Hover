---
name: hover-cli
description: Use when setting up Hover in a project or authoring/maintaining Playwright tests with the Hover CLI (@hover-dev/cli) — covers `setup`, `hover run` (CLI-mode authoring), saving/crystallizing specs, `optimize`, `extract`, and `re-record`. Hover lets an AI agent drive a real browser, then crystallizes the verified session into a plain @playwright/test spec that runs in CI with no agent.
metadata:
  trigger: Installing Hover, writing a Hover-driven Playwright test, or running any `npx @hover-dev/cli` command
  project: Hover (https://github.com/Hyperyond/Hover)
---

# Hover CLI

Hover is a local-first, BYO-agent testing tool. You describe a flow in plain language;
a coding-agent CLI you already have (`claude`, `codex`, …) drives a real debug Chrome over
CDP + Playwright MCP; the verified run **crystallizes into a plain `@playwright/test` spec**
under `__vibe_tests__/` that replays in CI with **no agent in the loop**.

The loop is always: **describe → agent verifies → crystallize once → CI replays forever.**

There are two ways to author a spec — the in-page **widget** and the **`hover run`** CLI —
and three commands that **post-process** specs you already saved (`optimize`, `extract`,
`re-record`). This skill is the CLI.

## Prerequisites

- **Node 22+** on PATH.
- **A coding-agent CLI** on PATH: `claude`, `codex`, `cursor-agent`, `aider`, `gemini-cli`,
  or `qwen-code`. Hover spawns whichever you have — it bundles **no AI runtime**. Auth uses
  that CLI's own login (e.g. `claude login` for a Claude Pro/Max subscription) or an API key
  (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
- For the **widget** path: a Vite / Astro / Nuxt / Next / Webpack project.
- For **`hover run`** only: just `@hover-dev/core` — no bundler, no config.

> **Every `run` / `re-record` / `optimize` spawns the agent and costs tokens.** A simple
> login+todo flow runs ~10–15 agent turns. Default model is `sonnet` (≈5× cheaper than opus).
> Don't loop these in a script without a budget in mind.

## Decision: which command?

```
Need to inject the widget into a running dev page, click ✨, type, Save as Spec?
  → `setup` once, then `pnpm dev` and use the in-page widget.

Want to author a spec from the terminal (scripting, no widget, non-bundler project)?
  → `hover run "<prompt>" --url <devUrl> --save <slug>`

Already have a saved spec and want to…
  …polish selectors / structure with an AI pass?   → `optimize <spec>`
  …lift flows shared across specs into Page Objects? → `extract`
  …refresh it against a drifted UI?                  → `re-record <spec>`
```

## `setup` — wire the widget into a project

```bash
npx @hover-dev/cli setup
```

1. Reads `package.json` → detects the bundler (Vite / Astro / Nuxt / Next / Webpack).
2. Reads the lockfile → picks the package manager (pnpm / yarn / bun / npm).
3. Installs the matching integration (`vite-plugin-hover`, `@hover-dev/astro`, …).
4. AST-edits the bundler config to register it. **Idempotent** — re-running no-ops.

Then `pnpm dev` (or your usual dev command) and a floating ✨ widget appears on the page.

Flags:

| Flag | Effect |
|---|---|
| `--vite` / `--astro` / `--nuxt` / `--next` / `--webpack` | Force a specific integration |
| `--cwd <path>` (`-C`) | Target one workspace in a monorepo |
| `--dry-run` | Print the install + config edit, change nothing |

**Monorepo:** run from the repo root. One bundler match → auto-dispatch into that workspace;
several → interactive picker in a TTY, or re-run with `--cwd apps/web` in CI.

**Next.js:** the CLI edits `next.config.*` **and** `instrumentation.ts`, then prints **one
manual line** to paste into `app/layout.tsx` (`<HoverScript />` inside `<body>`) — it won't
AST-mutate your JSX.

> `add` is the **deprecated** former name of `setup` — it still works but prints a deprecation
> notice. Always use `setup`.

## `hover run` — author a spec from the terminal (CLI mode)

```bash
hover run "log in, then add a todo named 'verify hover'" \
  --url http://localhost:5173 --save login
```

Drives the debug Chrome **without** the widget or any DOM injection. It:

- **Auto-launches** the isolated debug Chrome if none is up (persistent profile under
  `<tmpdir>/hover-chrome`, port 9222), then attaches over CDP.
- Is **NOT headless** — a real, visible Chrome you log into once. The first run on an
  auth-gated flow hits the login wall; log in, re-run, later runs reuse the session.
- Streams the run in a Clack-style line format, then (with `--save`) crystallizes to
  `__vibe_tests__/<slug>.spec.ts`.

Needs only the engine — **no `setup`, no bundler config** (`setup` exists to inject the
*widget*; CLI mode doesn't use it):

```bash
npm i -D @hover-dev/core @hover-dev/cli
```

Flags:

| Flag | Effect |
|---|---|
| `--url <devUrl>` | Page to open / drive (picks the matching tab). Always pass this. |
| `--save <slug>` | Crystallize to `__vibe_tests__/<slug>.spec.ts`. Omit → just watch. |
| `--agent <id>` | Override the agent (default `claude`; or `HOVER_AGENT`). |
| `--model <m>` | Override the model (default `sonnet`; or `HOVER_MODEL`). |
| `--cwd <path>` | Resolve `@hover-dev/core` + write the spec under this dir. |

CLI mode does **not** cover Record mode, the Fix prompt, or voice — those are widget-only.

After `--save`, review the file, then polish with `hover optimize <slug>`.

## Post-processing saved specs

These run the agent against specs that already exist. None of them need the widget.

```bash
npx @hover-dev/cli optimize <spec>          # AI pass → improved candidate
npx @hover-dev/cli extract                  # shared flows → Page Objects + fixtures
npx @hover-dev/cli re-record <spec>         # regenerate against the current UI
npx @hover-dev/cli re-record --dry-run <spec>
```

- **`optimize <spec>`** — proposes an improved spec as a **candidate + diff**; the original
  is kept untouched. Writes the candidate to `.hover/optimized/<slug>.spec.ts.draft` for you
  to diff-review. Steps it can't translate deterministically are marked `// KNOWN BUG` /
  `hover:optimizable:` rather than silently dropped. As a deterministic finishing step it
  also **soft-batches** the candidate: a trailing run of ≥2 independent field assertions
  becomes `expect.soft(...)`, so a failing run reports every bad field at once instead of
  halting on the first. Gating assertions (any with an action after them) are left hard. See
  the project's `optimize` mode (off / suggest / on) for whether this runs automatically.
- **`extract`** — lifts flows repeated across multiple specs into shared Page Objects +
  fixtures, then rewrites the specs to use them.
- **`re-record <spec>`** — reads the spec's JSDoc `Original prompt:` header, replays that
  prompt against your current dev server, and overwrites the file with fresh selectors.
  `--dry-run` runs the agent but writes nothing; `--cwd <path>` / `--port <n>` as needed.

## The crystallized spec

The output is **plain `@playwright/test`** — no Hover dependency, no proprietary format:

```bash
npx playwright test __vibe_tests__/login.spec.ts   # runs in CI, no agent, no cost
```

Selectors prefer `getByRole` / `getByLabel` / `getByText` over CSS/XPath, so the spec
survives markup changes that don't touch semantics. Each spec carries a JSDoc header with the
`Original prompt:` (what `re-record` replays) and the agent's outcome summary.

## Seeds (few-shot examples)

`.hover/rules/*.json` are **worked examples** (`{ name, signature, note, example: { steps, code } }`)
that feed Hover's optimization pass as few-shot guidance — e.g. pairing a click with
`waitForEvent('download')` via `Promise.all`. Drop files there by hand; the widget's read-only
**Seeds** tab lists what Hover currently sees. They are guidance, not a deterministic
match/emit engine.

## Environment & boundaries

- **`HOVER_AGENT`** / **`HOVER_MODEL`** / **`HOVER_CDP`** override agent / model / CDP endpoint.
- **`ANTHROPIC_API_KEY`** / **`OPENAI_API_KEY`** — used if the agent CLI isn't logged in.
- The debug Chrome is **isolated** — a clean profile, never your everyday browser. Hover never
  touches your normal Chrome session. You log into the app once inside it; the profile persists.
- The agent is **sandboxed to Playwright MCP only** — no filesystem/shell access. The single
  write path (`__vibe_tests__/`) is granted by the Hover service, not the agent.
- Default model `sonnet`; set `HOVER_MODEL=opus` only for genuinely hard flows.

## Quick reference

| Command | What it does |
|---|---|
| `setup` | Detect bundler + pm, install the integration, wire the config (widget path) |
| `run "<prompt>"` | Drive the debug Chrome from the terminal; `--save <slug>` crystallizes |
| `optimize <spec>` | AI pass → improved spec candidate (diff, original kept) |
| `extract` | Lift shared flows into Page Objects + fixtures |
| `re-record <spec>` | Regenerate a spec against the current UI |
| `--help` / `--version` | Usage / version |

Full docs: https://gethover.dev/docs/reference/cli
