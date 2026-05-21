<div align="center">

# Hover

<img src="docs/assets/banner.png" alt="Hover — the local-first, open-source way to author end-to-end tests with AI" width="100%" />

<p>
  <b>English</b> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" /></a>
  <a href="https://github.com/Hyperyond/Hover/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Hyperyond/Hover?style=flat-square&label=release&color=blueviolet" /></a>
  <a href="#roadmap"><img alt="Phase 1 shipped" src="https://img.shields.io/badge/phase-1%20shipped-22c55e?style=flat-square" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://github.com/Hyperyond/Hover/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Hyperyond/Hover?style=flat-square&color=2ecc71" /></a>
  <a href="https://github.com/Hyperyond/Hover/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Hyperyond/Hover?style=flat-square&color=8e44ad" /></a>
  <a href="#how-it-works"><img alt="Local CLI Agent First" src="https://img.shields.io/badge/architecture-Local%20CLI%20Agent%20First-black?style=flat-square" /></a>
</p>

</div>

---

Open the floating chat in your dev page, describe what you want to verify in plain English, watch AI operate your app for real. When the run is clean, click **Save as spec** — Hover writes a standard `@playwright/test` file you can run in CI without an agent in the loop, forever.

```
┌──────────────────────────────────────────────────────────┐
│  type natural language ── AI drives your Chrome via CDP  │
│              │                                           │
│              ▼                                           │
│       browser_click, browser_type, …  (Playwright MCP)   │
│              │                                           │
│              ▼                                           │
│   verified session ── Save as Playwright spec ──┐        │
│                                                 ▼        │
│                       __vibe_tests__/login-flow.spec.ts  │
│                       (plain @playwright/test, no agent) │
└──────────────────────────────────────────────────────────┘
```

## See it in action

Four real example apps under [`examples/`](./examples/), each stressing a different testing surface. The Hover widget on the right is driving each one — same loop, same UI, four very different workflows.

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/01-basic-app.png" alt="01 · basic-app — login + counter + todos" /><br/>
<sub><b>01 · <a href="./examples/basic-app"><code>basic-app</code></a> — the smoke baseline.</b> Login → increment a counter → add a todo. The agent ran the full sequence in 11 turns at $0.16; the result card surfaces both <b>Save as Skill</b> (replayable from the next conversation) and <b>Save as spec</b> (a standard <code>@playwright/test</code> file).</sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/02-stock-registration.png" alt="02 · stock-registration — multi-step brokerage form" /><br/>
<sub><b>02 · <a href="./examples/stock-registration"><code>stock-registration</code></a> — ~50-field broker application with conditional reveals.</b> The agent filled the text fields, then the form's own validator caught three required radio groups (Sex / Marital status / US tax residency). Hover pauses and surfaces a done card explaining why — the human can flip those three radios and re-run.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/03-e-commerce.png" alt="03 · e-commerce — cart and checkout" /><br/>
<sub><b>03 · <a href="./examples/e-commerce"><code>e-commerce</code></a> — Amazon-style storefront.</b> "Buy two top-rated headphones, ship to my saved address, pay with card." The agent picked the right category, added two items, and walked the cart up to the payment step. Long action chain, real cart state, ready for <b>Save as spec</b>.</sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/04-canvas-paint.png" alt="04 · canvas-paint — DOM toolbar amid canvas pixels" /><br/>
<sub><b>04 · <a href="./examples/canvas-paint"><code>canvas-paint</code></a> — a drawing app where the artwork is an opaque <code>&lt;canvas&gt;</code>.</b> Snapshots can't read pixel content, but the agent navigates the DOM toolbar (Tool · Color · Brush size · Save) end-to-end — proving Hover's semantic-selector preference holds up when the visual surface itself isn't introspectable.</sub>
</td>
</tr>
</table>

## Why Hover

Three things in this space already exist; Hover is what falls out when you combine them honestly:

| Tool | What it does | What's missing |
|---|---|---|
| **Playwright Codegen** | Records your clicks → spec | Can't think; just replay |
| **Stagehand / Midscene** | AI drives the browser at test time | Agent stays in the loop forever — slow, flaky, $$$ |
| **Hover** | AI drives the browser **once** to explore; saves a deterministic spec, a replayable agent skill, *and* a Jira-importable test case from the same click | The agent's job ends at "save"; CI runs plain Playwright |

The differentiator is the handoff. AI authors the session; the artifacts are decoupled from AI.

### One exploration, three audiences

A verified Hover session can crystallize three different ways. All three buttons sit on the same done card; pick any combination.

- **📜 Save as spec** → `__vibe_tests__/<slug>.spec.ts` — standard `@playwright/test` code with `getByRole / getByLabel / getByTestId` semantic selectors. Runs in CI, in pre-commit, on a fresh machine. No agent, no `claude` binary, no API key. **Ground truth for the flow.** The JSDoc header now carries a numbered plain-English `Steps:` block plus an `Expected:` block, so QA / PMs can read what the test does without opening Playwright docs.
- **💾 Save as Skill** → `.claude/skills/<slug>/SKILL.md` — a replayable instruction set the agent auto-discovers next time. Type *"execute login-as-claude"* in any future conversation and the recorded steps run again, in your real browser, using the same Playwright MCP sandbox. Skills are plain Markdown checked into your repo.
- **📋 Save as Jira case** → `__vibe_tests__/<slug>.case.csv` — a multi-row CSV in the [Xray Test Case Importer](https://docs.getxray.app/display/XRAY/Importing+Manual+Tests+using+Test+Case+Importer) format (Manual Test type, one Action per row, Expected Result on the last row). Drag it into Xray, [Zephyr Scale](https://support.smartbear.com/zephyr-scale-cloud/docs/en/test-management/test-cases/importing-test-cases.html), or the native Jira issue importer and the agent's flow shows up as a real, trackable test case — instantly assignable, linkable to a story / sprint, runnable as a Manual Test session. **No copy-pasting steps from a code editor into Jira ever again.**

| | `📜 .spec.ts` | `💾 SKILL.md` | `📋 .case.csv` |
|---|---|---|---|
| **Lands in** | `__vibe_tests__/` | `.claude/skills/` | `__vibe_tests__/` |
| **Read by** | Node + Playwright (CI) | Claude Code / agent | Xray · Zephyr Scale · Jira issue importer |
| **Audience** | CI, devs writing code | Future you, exploring | QA reviewing · PM tracking · auditor signing off |
| **Determinism** | Hard contract | Best-effort replay | Manual review — human runs and ticks |
| **Edit with** | Code editor | Markdown editor | Spreadsheet, or the test-mgmt UI after import |

Pick one or pick all three. Spec for CI, Skill for the next exploration, Case for the test team / sprint board — same session, same Save card.

<p align="center">
  <img src="docs/screenshots/05-three-save-buttons.png" alt="Three save buttons on one done card" width="48%" />
  <img src="docs/screenshots/06-jira-case-modal.png" alt="Save as Jira case modal" width="48%" />
</p>

### Shareable across the team, not locked into a tool

All three files check into the same git repo as the rest of your code. The moment a frontend developer saves a flow, everyone else can use it — **no Hover required, no agent, no token**:

- **QA / dedicated testers** clone the repo and run `pnpm test:e2e` for the deterministic specs, *or* drag the matching `.case.csv` into Xray / Zephyr Scale / Jira and run the same flow as a tracked Manual Test session. They don't need to install Hover, configure Chrome, or know what an "agent" is.
- **Other frontends** invoke a saved skill from their own Hover widget — *"execute login-as-claude"* skips the login dance and drops them straight into the screen they're actually working on. Skills become reusable "macros" the whole team builds up over time.
- **PR review** treats every saved spec as plain code — diff-able, blame-able, `requestChanges`-able. There's no proprietary file format, no SaaS dashboard, no "the test passed but we can't see how it got there".
- **Sprint planning / PM tracking** — `.case.csv` imports into Jira as a real test issue, linkable to a story, assignable to a tester, runnable as a Manual Test session. The Jira board now reflects what your app *can* do, not just what's planned.
- **Onboarding** is `git clone && pnpm install && pnpm test:e2e`. The test suite doubles as living documentation of how every important flow in the app works — new hires watch real browsers walk through real scenarios.

Everything checks into git. Nothing lives in a vendor's database. A spec written on a developer's laptop on Monday is reviewed by QA on Tuesday and runs in CI from Wednesday — same file, no export step.

## What you get when Phase 1 ships (this release)

- **Vite plugin** that injects a Shadow-DOM widget into your dev page. No-op in production. Marked `data-hover="true"` so your own Playwright runs can skip it.
- **Local Node service** on `127.0.0.1` that bridges the widget to a coding-agent CLI on your PATH (`claude` today; `codex` / `cursor` / `aider` are a one-file addition).
- **CDP-attached browser driving** — Hover talks to *your* Chrome (the one you're already debugging in), never spawns a fresh Chromium. Cookies, dev-tools state, the page you were inspecting — all preserved.
- **Save as Playwright spec** → `__vibe_tests__/<slug>.spec.ts`, uses `getByRole / getByLabel / getByTestId` semantic selectors. JSDoc header carries plain-English Steps + Expected blocks so non-coders can review.
- **Save as Skill** → `.claude/skills/<slug>/SKILL.md`, replayable by saying *"execute login-as-claude"* in a future conversation.
- **Save as Jira case** → `__vibe_tests__/<slug>.case.csv`, an Xray-compatible multi-row CSV that imports straight into Jira / Xray / Zephyr Scale as a Manual Test issue.
- **Alt-click "Assert This"** — Hold ⌥, click any element in your page, get a generated assertion (`expect(...).toHaveValue / toBeChecked / toHaveText / …`). Assertions accumulate; the next *Save as spec* bakes them in.
- **Record mode** — Toggle 🔴 Record, do the flow manually, get the same step sequence as if the agent had driven it. The downstream save path doesn't care whether the steps came from a human or from Claude.
- **Session persistence + resume** — Widget state survives page reload via `localStorage`; the next prompt resumes the same `claude --session-id`.
- **Strict agent sandbox** — Only the Playwright MCP server is callable. `Bash`, `Edit`, `Write`, `Read`, `WebFetch`, etc. all explicitly denied. `--max-budget-usd 0.50` hard ceiling per session.

## Quick start

You need three terminals on first run. Once Chrome and Vite are up, they stay running across many loops.

```bash
git clone https://github.com/Hyperyond/Hover.git
cd Hover
pnpm install
pnpm --filter basic-app exec playwright install chromium   # for `pnpm test:e2e` only
```

```bash
# Terminal 1 — debug-mode Chrome on port 9222, isolated profile
pnpm smoke:chrome
```

```bash
# Terminal 2 — basic-app on http://localhost:5173
pnpm dev:example:basic-app
```

```bash
# Terminal 3 — run the AI smoke loop (CDP preflight → invoke claude → stream events)
pnpm smoke
# or with custom target + prompt:
pnpm smoke http://localhost:5173/ "log in then add a todo named 'verify hover'"
```

Or just open `http://localhost:5173/` in the debug Chrome, click the ✨ floating button, and type into the widget.

## Install

```bash
pnpm add -D @hyperyond/vite-plugin
# or:  npm install -D @hyperyond/vite-plugin
# or:  yarn add -D @hyperyond/vite-plugin
```

That's it — no `.npmrc`, no auth tokens. The `@hyperyond/*` packages are public on npmjs.com.

Then start Chrome in debug mode so Hover can connect:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/hover-chrome
```

Open your dev server in *that* Chrome window. The ✨ launcher appears bottom-right.

## Use it in a React (Vite) project

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from '@hyperyond/vite-plugin';

export default defineConfig({
  plugins: [
    react(),
    hover(),                 // 👈 add this line
  ],
});
```

That's the whole integration. `vite dev` as usual; open your app in the debug Chrome; click ✨.

> Verified specs that you save via the widget land in `__vibe_tests__/` at your project root. Run them with `npx playwright test`. They import only `@playwright/test` and have no runtime dependency on Hover — so CI can run them with the widget completely disabled.

## Use it in a Vue (Vite) project

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { hover } from '@hyperyond/vite-plugin';

export default defineConfig({
  plugins: [
    vue(),
    hover(),                 // 👈 add this line
  ],
});
```

Same flow. Vite dev server → debug Chrome → ✨.

> Works the same in Svelte / Solid / Qwik / Astro / vanilla — anything Vite serves. The plugin is framework-agnostic; it just injects a Shadow DOM widget into your dev page via `transformIndexHtml`.

## Plugin options

```ts
hover({
  port: 51789,             // local WebSocket port; auto-bumps if taken
  enabled: true,           // false to disable (default: only in dev mode)
  chromeDebugPort: 9222,
  agentId: 'claude',       // matches @hyperyond/core's agent registry
  model: 'sonnet',         // 'opus' costs ~5× — use sonnet for browser driving
  maxBudgetUsd: 0.5,       // hard ceiling per agent invocation
});
```

## The five example apps

Each one is a real Vite app under `examples/` that stresses a different testing surface:

| App | Port | Stresses |
|---|---|---|
| [basic-app](./examples/basic-app) | 5173 | Login + counter + todos. Baseline smoke. |
| [e-commerce](./examples/e-commerce) | 5174 | Long action chains: product list → cart → checkout, cross-tab payment popup |
| [stock-registration](./examples/stock-registration) | 5175 | ~50-field brokerage form with conditional reveals — AI form-fill on rich controls |
| [canvas-paint](./examples/canvas-paint) | 5176 | DOM toolbar amidst `<canvas>` pixels — semantic selectors when snapshots are opaque |
| [payment-provider](./examples/payment-provider) | 5177 | Deliberately **no** Hover plugin — simulates a third-party origin in cross-tab flows |

Run any of them with `pnpm dev:example:<name>`.

## How it works

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Widget        │ ───────────────────▶ │  @hover/core     │
│  (Shadow DOM,  │ ◀─────────────────── │  Node service    │
│   in dev page) │   step events        │  (127.0.0.1)     │
└────────────────┘                      └────────┬─────────┘
                                                 │ spawn
                                                 ▼
                                        ┌──────────────────┐
                                        │  claude (CLI)    │
                                        │  --strict-mcp,   │
                                        │  --allowedTools  │
                                        │  mcp__playwright │
                                        └────────┬─────────┘
                                                 │ MCP
                                                 ▼
                                        ┌──────────────────┐
                                        │  Playwright MCP  │
                                        └────────┬─────────┘
                                                 │ CDP (port 9222)
                                                 ▼
                                        ┌──────────────────┐
                                        │  Your Chrome     │
                                        │  (existing tab)  │
                                        └──────────────────┘
```

Architecture and boundary constraints live in [CLAUDE.md](./CLAUDE.md). Per-package internals in [packages/core/README.md](./packages/core/README.md).

## Built on the shoulders of

- [**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) — the **Local CLI Agent First** architecture. Hover doesn't bundle any AI runtime; it `PATH`-scans for whatever coding-agent CLI the developer already has installed (`claude`, today) and treats it as a sidecar. The "local daemon as the only privileged process, agent-as-teammate" worldview, the strict-sandbox-by-default posture, and the per-invocation USD budget cap are all direct inspirations. Open Design proved the loop end-to-end for a *design* surface; Hover applies it to a *testing* surface, with the deterministic Playwright spec as the artifact instead of an HTML/PDF.
- [**Playwright Codegen**](https://playwright.dev/docs/codegen) — the *deterministic spec is the artifact* posture. AI authors are fashionable; AI runtime in CI is a recurring mistake. Hover keeps the artifact deterministic so CI never has to talk to a model.
- [**Stagehand**](https://github.com/browserbase/stagehand) and [**Midscene**](https://github.com/web-infra-dev/midscene) — proved that an LLM can usefully drive a real browser at test time. Hover takes the same loop and shortens it: agent drives the browser **once** during authoring, then steps out.

If your favourite agent (`codex`, `cursor-agent`, `aider`, `gemini`, `qwen-code`, …) isn't yet supported, it's a one-file addition in [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts) — PRs warmly welcome.

## Roadmap

- **v0.0.1-poc** — Phase 0 — end-to-end feasibility (`claude -p` drives Chrome via CDP) ✓
- **v0.1.x** — Phase 1 — Vite plugin + chat UI + persistent service + Save as Spec ✓ (you are here)
- **v0.2.x** — Phase 2 — multi-agent support (codex, cursor, aider), nicer step UI, error replay
- **v0.3.x** — Chrome extension (drop the Vite-plugin dependency for non-Vite stacks)

Phase 1 is what you can use today.

## Project status

🟢 **Phase 1 shipped** in v0.1.x — dogfood-ready. Use it on real Vite apps; expect some sharp edges around AI quirks (e.g., AI navigating to a same-origin URL still occasionally destroys the widget mid-stream; auto-resumes on reload).

Tracking issues at [github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR:

- Node 22+ / pnpm 10+
- Conventional Commits (enforced by `commit-msg` hook)
- `pnpm typecheck && pnpm test` before pushing
- Keep `main` runnable — speculative work on `experiment/<name>` branches

## License

[Apache-2.0](./LICENSE) © Hyperyond
