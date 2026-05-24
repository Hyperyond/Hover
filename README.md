<div align="center">

# Hover

<img src="docs/assets/banner.png" alt="Hover — the local-first, open-source way to author end-to-end tests with AI" width="100%" />

<p>
  <b>English</b> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<!-- Capability badges: what you can install, and where it runs -->
<p>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/cli"><img alt="@hover-dev/cli on npm" src="https://img.shields.io/npm/v/@hover-dev/cli?style=flat-square&label=npx%20%40hover-dev%2Fcli%20add&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="#install"><img alt="Covers Vite, Astro, Nuxt, Webpack, RN Web" src="https://img.shields.io/badge/covers-Vite%20%C2%B7%20Astro%20%C2%B7%20Nuxt%20%C2%B7%20Webpack%20%C2%B7%20RN%20Web-7c3aed?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/core"><img alt="@hover-dev/core on npm" src="https://img.shields.io/npm/v/@hover-dev/core?style=flat-square&label=%40hover-dev%2Fcore&color=cb3837&logo=npm&logoColor=white" /></a>
</p>

<!-- Project-meta badges: release / community / architecture -->
<p>
  <a href="https://github.com/Hyperyond/Hover/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Hyperyond/Hover?style=flat-square&label=release&color=blueviolet" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://github.com/Hyperyond/Hover/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Hyperyond/Hover?style=flat-square&color=2ecc71" /></a>
  <a href="https://github.com/Hyperyond/Hover/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Hyperyond/Hover?style=flat-square&color=8e44ad" /></a>
  <a href="#how-it-works"><img alt="Local CLI Agent First" src="https://img.shields.io/badge/architecture-Local%20CLI%20Agent%20First-black?style=flat-square" /></a>
</p>

</div>

---

Open the floating chat in your dev page, describe what you want to verify in plain English, watch AI operate your app for real. When the run is clean, click **Save as spec** — Hover writes a standard `@playwright/test` file you can run in CI without an agent in the loop, forever.

**No API key, no per-token billing.** Hover spawns the coding-agent CLI already on your `PATH` (claude / codex) and rides on the subscription you already pay for.

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

<p align="center">
  <a href="https://www.youtube.com/watch?v=ASWFWUyMUlc">
    <img src="https://img.youtube.com/vi/ASWFWUyMUlc/maxresdefault.jpg" alt="Hover demo — watch on YouTube" width="70%" />
  </a>
  <br/>
  <sub><b><a href="https://www.youtube.com/watch?v=ASWFWUyMUlc">▶ Watch the demo on YouTube</a></b></sub>
</p>

Ten real example apps live under [`examples/`](./examples/). Four stress different **testing surfaces** (login, multi-step form, cart checkout, canvas + DOM mix) — the Hover widget is driving each one. The other six exercise **bundler / framework coverage** (Astro, Nuxt, Next, webpack, React Native Web, plus a deliberately-uninstrumented third-party origin used by the e-commerce popup flow).

### Testing surfaces

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

### Bundler coverage

Each of the six targets below pairs the same counter + todo smoke page with a different host bundler / framework, so each Hover integration package has a dedicated dogfood ground.

| Example | Bundler / framework | Hover package | Port |
|---|---|---|---|
| [`examples/astro-app`](./examples/astro-app) | Astro 5 (static, `astro dev`) | [`@hover-dev/astro`](./packages/astro-integration/) | 5178 |
| [`examples/nuxt-app`](./examples/nuxt-app) | Nuxt 4 (SSR, `nuxt dev`) | [`@hover-dev/nuxt`](./packages/nuxt-integration/) | 5179 |
| [`examples/next-app`](./examples/next-app) | Next.js 16 App Router (Turbopack, `next dev`) | [`@hover-dev/next`](./packages/next-integration/) | 5182 |
| [`examples/webpack-app`](./examples/webpack-app) | vanilla webpack 5 + `webpack-dev-server` | [`webpack-plugin-hover`](./packages/webpack-plugin/) | 5180 |
| [`examples/rn-web-app`](./examples/rn-web-app) | React Native Web (Vite, `react-native` → `react-native-web` alias) | [`vite-plugin-hover`](./packages/vite-plugin/) | 5181 |
| [`examples/payment-provider`](./examples/payment-provider) | Vite, **no Hover plugin** | n/a | 5177 |

The `payment-provider` target is deliberately uninstrumented — `examples/e-commerce`'s "Pay with PayHover" button opens it in a new tab, and the agent has to discover, switch to, drive, and confirm callback into the original tab without a widget present.

### React Native — only the Web target is supported

Hover targets browser-runnable frontends. **React Native (native iOS / Android)** is not supported and not on the roadmap — Hover's stack (Chrome DevTools Protocol + Playwright + Shadow-DOM widget) doesn't translate to native mobile, and that space is well served by [Maestro](https://maestro.mobile.dev/), [Detox](https://wix.github.io/Detox/), and Appium. **React Native Web** projects compile to plain DOM and are fully covered — see [`examples/rn-web-app`](./examples/rn-web-app/) for the wire-up (a one-line `react-native` → `react-native-web` Vite alias).

## Why Hover

Several good tools already exist in this space; Hover is what falls out when you optimise for a different axis — **artifact portability**.

| Tool | What it does | The trade-off |
|---|---|---|
| **Playwright Codegen** | Records your clicks → `.spec.ts`. No AI, no auth | Can't think — just replays what you did literally |
| **Stagehand / Midscene** | AI-augmented tests; both ship caches so steady-state CI runs skip the LLM on cache hits. Configure an **OpenAI / Anthropic API key** — per-token billing on cache misses | Tests still run **inside the vendor SDK** + a cache file in your repo. Not portable to a plain Playwright runner |
| **Hover** | AI drives the browser **once** to explore; saves a deterministic spec, a replayable skill, *and* a Jira-importable case from the same click. **No API key — Hover spawns the coding-agent CLI already on your `PATH`** (claude / codex), so your existing Claude Pro/Max or ChatGPT subscription covers it | Crystallised spec is brittle to UI changes — when it breaks, re-run the agent (it doesn't self-heal at CI time) |

What Hover is **not** trying to do: be the better test-time AI runtime. Stagehand's caching + self-healing is more sophisticated than anything we'd build, and Midscene's vision fallback handles canvas / iOS / Android targets we can't touch.

What Hover IS trying to do: **make the saved artifact be plain `@playwright/test` code that runs with `npx playwright test` on a fresh machine, zero AI deps**. The agent's job ends at "save"; CI is pure Playwright. That's the handoff.

### One exploration, three audiences

A verified Hover session can crystallize three different ways. A single **💾 Save as ▾** dropdown on the done card opens a menu listing all three; pick one, two, or all three.

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
  <img src="docs/screenshots/05-save-dropdown.png" alt="Save dropdown — Playwright spec, Claude Code Skill, Jira test case (CSV)" width="48%" />
  <img src="docs/screenshots/06-jira-case-modal.png" alt="Save as Jira case modal" width="48%" />
</p>

### Shareable across the team, not locked into a tool

All three files check into the same git repo as the rest of your code. The moment a frontend developer saves a flow, everyone else can use it — **no Hover required, no agent, no token**:

- **QA / dedicated testers** clone the repo and run `pnpm test:e2e` for the deterministic specs, *or* drag the matching `.case.csv` into Xray / Zephyr Scale / Jira and run the same flow as a tracked Manual Test session. They don't need to install Hover, configure Chrome, or know what an "agent" is.
- **Other frontends** invoke a saved skill from their own Hover widget — *"execute login-as-claude"* replays the recorded steps in their own browser session. Skills work best for flows that don't depend on user-specific data or dynamic element IDs — think navigation sequences, form patterns, and UI explorations rather than session-bound state.
- **PR review** treats every saved spec as plain code — diff-able, blame-able, `requestChanges`-able. There's no proprietary file format, no SaaS dashboard, no "the test passed but we can't see how it got there".
- **Sprint planning / PM tracking** — `.case.csv` imports into Jira as a real test issue, linkable to a story, assignable to a tester, runnable as a Manual Test session. The Jira board now reflects what your app *can* do, not just what's planned.
- **Onboarding** is `git clone && pnpm install && pnpm test:e2e`. The test suite doubles as living documentation of how every important flow in the app works — new hires watch real browsers walk through real scenarios.

Everything checks into git. Nothing lives in a vendor's database. A spec written on a developer's laptop on Monday is reviewed by QA on Tuesday and runs in CI from Wednesday — same file, no export step.

## What you get in v0.2.x (Phase 2 shipped)

- **Vite plugin** that injects a Shadow-DOM widget into your dev page. No-op in production. Marked `data-hover="true"` so your own Playwright runs can skip it.
- **No API key, no `.env`, no per-token billing.** Hover spawns whichever coding-agent CLI is on your `PATH` and reuses the subscription you already pay for (Claude Pro / Max, ChatGPT Pro). The `@hover-dev/core` package contains zero LLM SDK code — there's nothing to authenticate against. Get the most out of the agent quota you've already bought.
- **Multi-agent.** `claude` (hard sandbox, recommended) and `codex` (soft sandbox) are both wired. Service auto-detects which one you have on PATH; the widget header shows the active agent as a pill (`claude ▾`) with a dropdown to switch on the fly. `cursor-agent` / `aider` / `gemini-cli` are one-file additions to the registry.
- **Per-agent sandbox policy.** Hard-sandbox agents (claude) get an explicit allow/deny list so only Playwright MCP is callable; `Bash`, `Edit`, `Write`, `Read`, `WebFetch`, etc. all explicitly denied; `--max-budget-usd` ceiling supported. Soft-sandbox agents (codex) can't disable their built-in tools at the CLI level, so we use `--sandbox read-only` + a strict `developer_instructions` system prompt; the widget marks these with a ⚠ badge so you know the surface is broader.
- **Widget v2 — info hierarchy that scales.** Conversation reads as one row per natural-language intent, not a flood of raw `browser_click` events. Tool-call detail is folded behind a chevron; the running step gets a mint left bar + spinner. Dark panel, single mint accent, custom inline-SVG icons + theme-matched tooltip — designed to sit unobtrusively over your dev page.
- **Result & Findings cards.** At the end of a run the widget renders the agent's verification report as a dedicated Result card (markdown-stripped, plain text) with the Save-as dropdown attached. If the agent's summary contained a `## Findings` block — bugs, minor issues, observations — those land in a separate Findings card with severity-coded rows. Bug discovery is a first-class output, not buried in narration.
- **CDP-attached browser driving.** Hover drives a debug Chrome it launches under an isolated profile at `<tmpdir>/hover-chrome`, never a fresh headless Chromium. Your main Chrome profile is untouched — log in once inside the debug Chrome and that session persists across Hover commands and dev-server restarts, because the profile dir is reused.
- **Three crystallisation formats.**
  - **Save as Playwright spec** → `__vibe_tests__/<slug>.spec.ts`, uses `getByRole / getByLabel / getByTestId` semantic selectors. JSDoc header carries plain-English Steps + Expected blocks so non-coders can review.
  - **Save as Skill** → `.claude/skills/<slug>/SKILL.md`, replayable by saying *"execute login-as-claude"* in a future conversation.
  - **Save as Jira case** → `__vibe_tests__/<slug>.case.csv`, an Xray-compatible multi-row CSV that imports straight into Jira / Xray / Zephyr Scale as a Manual Test issue.
- **Alt-click "Assert This"** — Hold ⌥, click any element in your page, get a generated assertion (`expect(...).toHaveValue / toBeChecked / toHaveText / …`). Assertions accumulate; the next *Save as spec* bakes them in.
- **Record mode** — Toggle Record, do the flow manually, get the same step sequence as if the agent had driven it. The downstream save path doesn't care whether the steps came from a human or from Claude.
- **Session persistence + resume.** Widget state survives page reload via `localStorage`; the next prompt resumes the same `claude --session-id`.

### Bug discovery as a first-class output

The agent's verification report and any bugs it finds get their own cards at the end of the run — separate from the step-by-step timeline. The Result card holds the narrative summary (PASS / FAIL + steps the agent took); the Findings card lists every `## Bug` / `## Minor` / `## Note` the agent flagged, severity-coloured.

<p align="center">
  <img src="docs/screenshots/07-findings-card.png" alt="Findings card — bugs and minor issues the agent flagged" width="60%" />
</p>

The system prompt teaches the agent to emit this structured block at the end of every run, so QA reading the saved spec can scan the bug list without scrolling through tool calls.

### Pick your agent — claude, codex, or roll your own

The widget header shows the active agent as a pill. Click it for a dropdown of every agent in the registry, marked with what's installed on your PATH and what isn't (with copy-pasteable install hints). Switch on the fly without restarting the dev server.

<p align="center">
  <img src="docs/screenshots/08-agents-dropdown.png" alt="Agent picker dropdown — Claude Code installed, OpenAI Codex available" width="50%" />
</p>

`claude` is the recommended default (hard sandbox, MCP-only tool surface). `codex` is wired as the second-class citizen (soft sandbox — codex doesn't expose a built-in-tool deny list at the CLI level, so we lean on its `--sandbox read-only` flag + a strict `developer_instructions` prompt). The widget marks soft-sandbox agents with a ⚠ badge so you know the surface is broader.

Adding `cursor-agent` / `aider` / `gemini-cli` / your own coding-agent CLI is one file in [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts).

## Quick start

You need two terminals on first run. Once Chrome and Vite are up, they stay running across many loops.

```bash
git clone https://github.com/Hyperyond/Hover.git
cd Hover
pnpm install
pnpm --filter basic-app exec playwright install chromium   # for `pnpm test:e2e` only
```

```bash
# Terminal 1 — basic-app on http://localhost:5173. Examples pass
# `autoLaunchChrome: true`, so this ALSO spawns a debug Chrome on port 9222
# (isolated profile under <tmpdir>/hover-chrome) navigated to the dev URL.
pnpm dev:example:basic-app
```

```bash
# Terminal 2 — run the AI smoke loop (CDP preflight → invoke claude → stream events)
pnpm smoke
# or with custom target + prompt:
pnpm smoke http://localhost:5173/ "log in then add a todo named 'verify hover'"
```

Or just open `http://localhost:5173/` in the debug Chrome, click the ✨ floating button, and type into the widget.

## Install

**One command, zero global installs:**

```bash
npx @hover-dev/cli add
```

The CLI detects your bundler (Vite / Astro / Nuxt / Webpack), reads your lockfile to pick the right package manager (pnpm / yarn / bun / npm), installs the matching Hover package as a dev dep, and AST-edits your config file. Idempotent — safe to re-run.

Force a specific bundler if detection picks wrong:

```bash
npx @hover-dev/cli add --vite      # vite-plugin-hover
npx @hover-dev/cli add --astro     # @hover-dev/astro
npx @hover-dev/cli add --nuxt      # @hover-dev/nuxt
npx @hover-dev/cli add --webpack   # webpack-plugin-hover
```

Preview without changing anything: `npx @hover-dev/cli add --dry-run`.

<details>
<summary>Or install the package manually</summary>

```bash
pnpm add -D vite-plugin-hover     # for Vite projects
# or `@hover-dev/astro`, `@hover-dev/nuxt`, `webpack-plugin-hover`
```

Then add the plugin/integration to your bundler config — see the per-package READMEs under [`packages/`](./packages).

</details>

No `.npmrc`, no auth tokens. All packages are public on npmjs.com.

**No `.env` to fill out either.** Hover doesn't ship an LLM SDK; it shells out to whichever coding-agent CLI is on your `PATH` — `claude` ([install](https://docs.claude.com/claude-code)) or `codex` ([install](https://developers.openai.com/codex)). Whatever you're already logged into covers it.

Then just run your dev server:

```bash
pnpm dev
```

Open your dev URL in any Chrome. The ✨ launcher appears bottom-right and tells you what to do via its colour:

- **Blue** — you're already in a debug Chrome. Click and chat.
- **Amber** — no debug Chrome yet. Click and the widget launches one for you (isolated profile under `<tmpdir>/hover-chrome`, navigated to your dev URL), then prompts you to switch over.
- **Gray** — a debug Chrome is running, but this window isn't it. Click to bring the right window to the front.

Prefer it to pre-warm Chrome at `vite dev`? `hover({ autoLaunchChrome: true })`. Prefer to start Chrome yourself? `pnpm exec hover-chrome` (or `npx hover-chrome`).

## Use it in a React (Vite) project

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hover } from 'vite-plugin-hover';

export default defineConfig({
  plugins: [
    react(),
    hover(),                 // 👈 add this line
  ],
});
```

That's the whole integration. `vite dev` as usual; open your app; click ✨. The launcher colour tells you what (if anything) it needs from you.

> Verified specs that you save via the widget land in `__vibe_tests__/` at your project root. Run them with `npx playwright test`. They import only `@playwright/test` and have no runtime dependency on Hover — so CI can run them with the widget completely disabled.

## Use it in a Vue (Vite) project

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { hover } from 'vite-plugin-hover';

export default defineConfig({
  plugins: [
    vue(),
    hover(),                 // 👈 add this line
  ],
});
```

Same flow. Vite dev server → debug Chrome → ✨.

> Works the same in Svelte / Solid / Qwik / vanilla — anything whose Vite dev server actually runs user Vite plugins' `transformIndexHtml`. The plugin is framework-agnostic at that layer.
>
> **Astro** has its own HTML pipeline that bypasses `transformIndexHtml` on `.astro` pages — use the [`@hover-dev/astro`](./packages/astro-integration/) integration instead, which wraps the same service + widget bundle behind Astro's `injectScript` API.
>
> **Nuxt** renders HTML through Nitro, not Vite, so `transformIndexHtml` is a no-op for Nuxt's SSR responses — use the [`@hover-dev/nuxt`](./packages/nuxt-integration/) module, which pushes the widget into `nuxt.options.app.head.script` (Nitro inlines it into the SSR'd HTML).
>
> **Webpack-based projects** (vanilla `webpack-dev-server`, Rspack, Rsbuild, legacy CRA via `craco`, legacy Vue CLI via `configureWebpack`) — use [`webpack-plugin-hover`](./packages/webpack-plugin/), which taps `HtmlWebpackPlugin`'s `alterAssetTagGroups` hook.
>
> **Next.js** ships Turbopack as the default bundler since Next 16 and Turbopack does not load webpack plugins. Users on `next dev --webpack` can wire `webpack-plugin-hover` manually (see the package README). A Turbopack-native `@hover-dev/next` is on the roadmap.

## Plugin options

```ts
hover({
  port: 51789,             // local WebSocket port; auto-bumps if taken
  enabled: true,           // false to disable (default: only in dev mode)
  chromeDebugPort: 9222,
  agentId: 'claude',       // matches @hover-dev/core's agent registry
  model: 'sonnet',         // 'opus' costs ~5× — use sonnet for browser driving
  maxBudgetUsd: undefined, // hard $ ceiling per agent invocation; no default — use Stop in the widget
});
```

## The ten example apps

Each one is a real, runnable app under `examples/` — together they cover both testing surfaces and bundler/framework integrations:

| App | Port | Stresses |
|---|---|---|
| [basic-app](./examples/basic-app) | 5173 | Login + counter + todos. Baseline smoke · Vite + React |
| [e-commerce](./examples/e-commerce) | 5174 | Long action chains: product list → cart → checkout, cross-tab payment popup · Vite + React |
| [stock-registration](./examples/stock-registration) | 5175 | ~50-field brokerage form with conditional reveals — AI form-fill on rich controls · Vite + React |
| [canvas-paint](./examples/canvas-paint) | 5176 | DOM toolbar amidst `<canvas>` pixels — semantic selectors when snapshots are opaque · Vite + React |
| [payment-provider](./examples/payment-provider) | 5177 | Deliberately **no** Hover plugin — simulates a third-party origin in cross-tab flows · Vite |
| [astro-app](./examples/astro-app) | 5178 | Astro 5 static smoke page — verifies `@hover-dev/astro` via `injectScript` |
| [nuxt-app](./examples/nuxt-app) | 5179 | Nuxt 4 SSR smoke page — verifies `@hover-dev/nuxt` via `app.head.script` |
| [next-app](./examples/next-app) | 5182 | Next.js 16 App Router smoke page (Turbopack default) — verifies `@hover-dev/next` via `withHover` + `instrumentation.ts` + `<HoverScript />` |
| [webpack-app](./examples/webpack-app) | 5180 | Vanilla webpack 5 + `webpack-dev-server`, plain JS no React — verifies `webpack-plugin-hover` via `alterAssetTagGroups` |
| [rn-web-app](./examples/rn-web-app) | 5181 | React Native Web — `react-native` imports aliased to `react-native-web`, compiled to DOM via Vite. Demonstrates RN Web is in scope (RN native is not) |

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
- **v0.1.x** — Phase 1 — Vite plugin + chat UI + persistent service + Save as Spec ✓
- **v0.2.x** — Phase 2 — multi-agent (claude + codex), dark widget v2, Result + Findings cards, custom tooltip, code-quality pass ✓
- **v0.3.x** — **`@hover-dev/next` — Next.js 16+ Turbopack-native integration** ✓ **(you are here)**. Three pieces — `withHover(nextConfig, opts)` wrapper for `next.config.mjs`, a `<HoverScript />` Server Component for `app/layout.tsx`, and a `register()` helper for `instrumentation.ts`. The existing `webpack-plugin-hover` only covers `next dev --webpack`; this package is the Turbopack-native path. `npx @hover-dev/cli add` routes Next projects here automatically.
- **v0.4.x** — **Click → Suggest fix prompt.** Because Hover lives inside the dev page, it can read the source-location annotations Vite/framework plugins inject (React fiber `_debugSource`, Vue's `vite-plugin-vue-inspector` `data-v-inspector` attribute) and pair them with the DOM selector chain. Each row in the Findings card gets a "Suggest fix" button that copies a precise prompt — file path + line + column + component path + selector — straight into your coding-agent chat. *Caveat: React ≤18 and Vue + inspector plugin work out of the box; React 19 dropped `_debugSource` so we'll ship our own Vite transform (framework-agnostic `data-hover-source` attributes) to fill the gap.*
- **v0.5.x** — **multi-tab / cross-origin spike + more agents.**
  - Multi-tab / cross-origin flows (Stripe, OAuth, "Pay with PayHover") — spike phase. `examples/payment-provider` already stresses the `window.open` → `postMessage` callback path, but the agent's handling of `browser_tabs(list/select)` is brittle in the wild. Tracking issue to follow; shape TBD before we commit it to a release.
  - More agents wired into the [registry](./packages/core/src/agents/registry.ts) — `cursor-agent` / `aider` / `gemini-cli` / `qwen-code`.
- **v0.6.x** — Chrome extension (drop the Vite-plugin dependency for non-Vite stacks)

Phase 2 is what you can use today.

## Project status

🟢 **Phase 2 shipped** in v0.2.x — dogfood-ready. Use it on real Vite apps; the navigation-to-same-origin quirk that occasionally destroyed the widget mid-stream is now caught up-front by a hardened system prompt (the agent is explicitly forbidden from `browser_navigate`-ing to the active origin). Auto-resumes on reload if it slips through.

Tracking issues at [github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR:

- Node 22+ / pnpm 10+
- Conventional Commits (enforced by `commit-msg` hook)
- `pnpm typecheck && pnpm test` before pushing
- Keep `main` runnable — speculative work on `experiment/<name>` branches

## License

[Apache-2.0](./LICENSE) © Hyperyond
