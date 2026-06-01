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
  <a href="https://gethover.dev/docs"><img alt="Documentation" src="https://img.shields.io/badge/docs-gethover.dev%2Fdocs-7CFFA8?style=flat-square&logo=readthedocs&logoColor=white" /></a>
  <a href="https://github.com/Hyperyond/Hover/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Hyperyond/Hover?style=flat-square&label=release&color=blueviolet" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://github.com/Hyperyond/Hover/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Hyperyond/Hover?style=flat-square&color=2ecc71" /></a>
  <a href="https://github.com/Hyperyond/Hover/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Hyperyond/Hover?style=flat-square&color=8e44ad" /></a>
  <a href="#how-it-works"><img alt="Local CLI Agent First" src="https://img.shields.io/badge/architecture-Local%20CLI%20Agent%20First-black?style=flat-square" /></a>
</p>

</div>

---

Open the floating chat in your dev page, describe what you want to verify in plain English, and watch AI operate your app for real. When the run is clean, click **Save as spec** — Hover writes a standard `@playwright/test` file that runs in CI without an agent in the loop, forever.

**No API key, no per-token billing.** Hover spawns the coding-agent CLI already on your `PATH` (claude / codex) and rides on the subscription you already pay for.

The differentiator: AI authors the test, but the saved artifact is plain `@playwright/test` code that runs with `npx playwright test` on a fresh machine — no agent, no model, no key. The LLM cost is a one-off you opt into at authoring time, never a recurring tax on green builds.

## See it in action

<p align="center">
  <a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">
    <img src="https://img.youtube.com/vi/lQV5dmVWaIA/maxresdefault.jpg" alt="Hover demo — watch on YouTube" width="70%" />
  </a>
  <br/>
  <sub><b><a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">▶ Watch the demo on YouTube</a></b></sub>
</p>

Ten real example apps live under [`examples/`](./examples/). Four stress different **testing surfaces**; the other six exercise **bundler / framework coverage**.

### Testing surfaces

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/01-basic-app.png" alt="01 · basic-app — login + counter + todos" /><br/>
<sub><b>01 · <a href="./examples/basic-app"><code>basic-app</code></a> — the smoke baseline.</b> Login → counter → add a todo. The agent ran the full sequence in 11 turns at $0.16; the result card offers both <b>Save as Skill</b> and <b>Save as spec</b>.</sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/02-stock-registration.png" alt="02 · stock-registration — multi-step brokerage form" /><br/>
<sub><b>02 · <a href="./examples/stock-registration"><code>stock-registration</code></a> — ~50-field broker application with conditional reveals.</b> The agent fills the text fields, then the form's validator catches required radio groups; Hover surfaces a done card so the human can finish those and re-run.</sub>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/screenshots/03-e-commerce.png" alt="03 · e-commerce — cart and checkout" /><br/>
<sub><b>03 · <a href="./examples/e-commerce"><code>e-commerce</code></a> — Amazon-style storefront.</b> "Buy two top-rated headphones, ship to my saved address, pay with card." Long action chain, real cart state, ready for <b>Save as spec</b>.</sub>
</td>
<td width="50%" valign="top">
<img src="docs/screenshots/04-canvas-paint.png" alt="04 · canvas-paint — DOM toolbar amid canvas pixels" /><br/>
<sub><b>04 · <a href="./examples/canvas-paint"><code>canvas-paint</code></a> — a drawing app whose artwork is an opaque <code>&lt;canvas&gt;</code>.</b> Snapshots can't read pixels, but the agent navigates the DOM toolbar end-to-end — Hover's semantic-selector preference holds even when the visual surface isn't introspectable.</sub>
</td>
</tr>
</table>

### Bundler coverage

Each target below pairs a counter + todo smoke page with a different host bundler, so every Hover integration has a dedicated dogfood ground.

| Example | Bundler / framework | Hover package | Port |
|---|---|---|---|
| [`examples/astro-app`](./examples/astro-app) | Astro 5 (static, `astro dev`) | [`@hover-dev/astro`](./packages/astro-integration/) | 5178 |
| [`examples/nuxt-app`](./examples/nuxt-app) | Nuxt 4 (SSR, `nuxt dev`) | [`@hover-dev/nuxt`](./packages/nuxt-integration/) | 5179 |
| [`examples/next-app`](./examples/next-app) | Next.js 16 App Router (Turbopack, `next dev`) | [`@hover-dev/next`](./packages/next-integration/) | 5182 |
| [`examples/webpack-app`](./examples/webpack-app) | vanilla webpack 5 + `webpack-dev-server` | [`webpack-plugin-hover`](./packages/webpack-plugin/) | 5180 |
| [`examples/rn-web-app`](./examples/rn-web-app) | React Native Web (Vite alias) | [`vite-plugin-hover`](./packages/vite-plugin/) | 5181 |
| [`examples/payment-provider`](./examples/payment-provider) | Vite, **no Hover plugin** | n/a | 5177 |

`payment-provider` is deliberately uninstrumented — e-commerce's "Pay with PayHover" button opens it in a new tab, and the agent has to discover, switch to, and drive it without a widget present.

**React Native:** only the **Web** target is supported (it compiles to plain DOM). Native iOS / Android is out of scope — the CDP + Playwright + Shadow-DOM stack doesn't translate to native, and [Maestro](https://maestro.mobile.dev/) / [Detox](https://wix.github.io/Detox/) / Appium serve that space.

## Why Hover

Several good tools exist in this space; Hover is what falls out when you optimise for a different axis — **artifact portability**.

| Tool | What it does | The trade-off |
|---|---|---|
| **Playwright Codegen** | Records your clicks → `.spec.ts`. No AI | Can't think — replays what you did literally |
| **Stagehand / Midscene** | AI-augmented tests; caches skip the LLM on steady-state runs. Needs an OpenAI / Anthropic key (per-token on cache misses) | Tests run **inside the vendor SDK** + a cache file. Not portable to a plain Playwright runner |
| **Hover** | AI drives the browser **once** to explore, then saves a deterministic spec, a replayable skill, *and* a Jira-importable case from the same click. **No API key — spawns the CLI on your `PATH`** (claude / codex / cursor-agent / aider / gemini-cli / qwen-code) | Crystallised spec is brittle to UI changes — when it breaks, re-run the agent (it doesn't self-heal at CI time) |

Hover is **not** trying to be the better test-time AI runtime — Stagehand's caching + self-healing and Midscene's vision fallback are more sophisticated than anything we'd build. Hover makes the saved artifact be plain `@playwright/test` code that runs with zero AI deps. The agent's job ends at "save"; CI is pure Playwright.

**Zero AI at runtime, zero tokens in CI.** Some AI-testing tools keep a model in the loop when the test *runs* — every PR, every nightly pays for LLM calls and needs a key wired into CI. Hover spends the model once, at authoring time, on the machine of a developer who already pays for a `claude` / `codex` subscription. The saved `.spec.ts` then runs forever with no model and no per-token bill.

### Crystallise three ways

A single **💾 Save as ▾** dropdown on the done card crystallises one verified session three ways. Pick one, two, or all three — every file checks into the same git repo, readable by teammates who never install Hover.

| | `📜 .spec.ts` | `💾 SKILL.md` | `📋 .case.csv` |
|---|---|---|---|
| **Lands in** | `__vibe_tests__/` | `.claude/skills/` | `__vibe_tests__/` |
| **Read by** | Node + Playwright (CI) | Claude Code / agent | Xray · Zephyr Scale · Jira importer |
| **Audience** | CI, devs writing code | Future you, exploring | QA reviewing · PM tracking |
| **Determinism** | Hard contract | Best-effort replay | Manual review |
| **Edit with** | Code editor | Markdown editor | Spreadsheet / test-mgmt UI |

The spec is `getByRole / getByLabel / getByText` semantic selectors with a JSDoc header carrying plain-English `Steps:` + `Expected:` blocks, so QA and PMs can read what a test does without opening Playwright docs. Skills replay from a future conversation (*"execute login-as-claude"*). The Jira case imports as a real, trackable Manual Test issue.

<p align="center">
  <img src="docs/screenshots/05-save-dropdown.png" alt="Save dropdown — Playwright spec, Claude Code Skill, Jira test case (CSV)" width="48%" />
  <img src="docs/screenshots/06-jira-case-modal.png" alt="Save as Jira case modal" width="48%" />
</p>

## What you get today

- **Five bundler integrations.** Vite, Astro, Nuxt, Next.js (Turbopack), and webpack 5 each have a dedicated package; React Native Web rides on `vite-plugin-hover`. The plugin injects a Shadow-DOM widget into your dev page, is a no-op in production, and is marked `data-hover="true"` so your own Playwright runs skip it.
- **No API key, no `.env`, no per-token billing.** Hover spawns whichever coding-agent CLI is on your `PATH` and reuses the subscription you already pay for. `@hover-dev/core` contains zero LLM SDK code.
- **Six agents wired.** `claude` (hard sandbox, recommended), `codex`, `cursor-agent`, `aider`, `gemini-cli`, `qwen-code` (the last five soft-sandbox — ⚠ badge in the dropdown). The service auto-detects what's on PATH; the widget header shows the active agent and switches on the fly. New agents are one file in the registry.
- **Per-agent sandbox.** Hard-sandbox agents get an allow/deny list so only Playwright MCP is callable (`Bash` / `Edit` / `Write` / `Read` / `WebFetch` denied), plus a `--max-budget-usd` ceiling. Soft-sandbox agents run `--sandbox read-only` + a strict system prompt and carry a ⚠ badge.
- **Three crystallisation formats** — Playwright spec, replayable Skill, Jira-importable CSV — from the same Save card (see [above](#crystallise-three-ways)).
- **Visibility-guarded specs.** Every interaction in a saved spec is wrapped in `{ const el = …; await expect(el).toBeVisible(); await el.<action>; }`, so UI drift fails loudly with a named assertion instead of a generic 30 s timeout.
- **⟳ Re-record.** When the UI shifts enough to break a spec, the agent replays the spec's `Original prompt:` against the current UI and rewrites the selectors. From the widget's **Saved sessions** overlay or `pnpm hover re-record <spec>`. CI stays pure Playwright — AI only at the authoring step.
- **Record mode + checks.** Toggle Record, do the flow by hand, get the same step sequence. A sub-toolbar switches the next click between `● Record / ✓ Exists / ¶ Says / = Equals`; checks bake into the same `.spec.ts`.
- **CDP-attached driving.** Hover drives an isolated debug Chrome under `<tmpdir>/hover-chrome`, never your main profile. Log in once; the profile persists across runs.
- **Result & Findings cards.** The agent's verification report renders as a Result card; any `## Findings` (bugs / minor / notes) land in a severity-coded Findings card. Bug discovery is a first-class output.
- **Session persistence.** Widget state survives reload via `localStorage`; the next prompt resumes the same `claude --session-id`.

<p align="center">
  <img src="docs/screenshots/08-agents-dropdown.png" alt="Agent picker — installed vs. available agents" width="48%" />
  <img src="docs/screenshots/07-findings-card.png" alt="Findings card — severity-coded bugs the agent flagged" width="48%" />
</p>
<p align="center">
  <sub><b>Left:</b> switch agents from the widget header; installed ones are live, the rest carry a copy-paste install hint. <b>Right:</b> the agent's bugs land in a severity-coded Findings card, kept apart from the step timeline.</sub>
</p>

### Security testing

> ⚠️ **Authorised testing only.** Security mode operates on the dev server on your own machine. Pointing it at systems you don't own or have written authorisation to test is illegal in most jurisdictions and against the [Security Policy](./SECURITY.md).

`@hover-dev/security` is Hover's first optional plugin. Install it next to the base plugin and the widget grows a **Security testing** mode (the panel turns orange to signal altered state). Hover routes the debug Chrome through a local HTTPS MITM proxy — built on [mockttp](https://github.com/httptoolkit/mockttp), zero external deps, no Python or system CA install — and the agent inspects captured API calls and replays them with mutations.

**What it probes for:** IDOR, auth bypass, parameter tampering, mass assignment, missing security headers (CSP / X-Frame-Options / HSTS / SameSite), and PII leakage. **Out of scope:** SQL injection, SSRF, command injection, and fuzzing loops — run a server-side scanner for those.

Confirmed findings crystallise into `.security.spec.ts` regression tests that run in CI without the proxy or agent. Full walkthrough: [docs/features/security](https://gethover.dev/docs/features/security). Wiring is in [Use it in your project](#use-it-in-your-project) below.

### Voice mode

Hold the round 🎙 button next to Send (push-to-talk), speak your prompt in Chinese or English (Hover detects the language), release to fire. Key step events get read back aloud in the same language so you can keep your eyes on the page. Pure browser-native Web Speech API — no API keys; Chrome 139+ runs the recogniser on-device. Mute narration from the ⚙ settings panel. Details: [docs/features/voice](https://gethover.dev/docs/features/voice).

### Fix prompt

A Vite transform stamps `data-hover-source="file:line:col"` onto every host element you authored in JSX / Vue / Svelte / Astro. Click the **⌖ Fix** button, click any element, type what you'd like to change, hit ⌘↵, and Hover assembles a fact-only prompt — your intent, the element's source `file:line:col`, the ancestor source chain, the component chain, the Playwright selector, and the outer HTML — onto your clipboard. Paste into Cursor / Claude Code / Windsurf and the agent has exact context.

<p align="center">
  <img src="docs/screenshots/09-fix-prompt-comparison.png" alt="Vague natural-language ask vs. a structured, source-attributed Fix prompt" width="80%" />
</p>

The ancestor chain matters for wrapper-rendered hosts: a `<StyledButton>` renders a `<button>` from inside library source, so the element's own stamp points at library internals — but the DOM ancestor chain still carries your call site. Full walkthrough + the five wrapper shapes it handles: [docs/features/fix-prompt](https://gethover.dev/docs/features/fix-prompt).

## Install

Three steps, all copy-paste. Detailed walkthrough in the [install docs](https://gethover.dev/docs/get-started/install).

### 1 · Prerequisites

- **Node 22+** on PATH.
- One coding-agent CLI installed and logged in:

  | Agent | Install + login | What it costs |
  |---|---|---|
  | Claude Code | `npm install -g @anthropic-ai/claude-code` then `claude login` | rides on your Claude Pro / Max subscription |
  | OpenAI Codex | `npm install -g @openai/codex` then `codex login` | rides on your ChatGPT plan |

  Either works. Switch from the widget header anytime — Hover detects both on `PATH`. No new API keys, no `.env`.

### 2 · Add Hover to your project

```bash
npx @hover-dev/cli add
```

That command detects your bundler (`package.json`) and package manager (lockfile), installs the right Hover package as a `devDependency`, and AST-edits your bundler config. It's **idempotent**; `--dry-run` prints changes without touching anything; `--vite` / `--astro` / `--nuxt` / `--next` / `--webpack` force a bundler.

<details>
<summary><b>Monorepo? turbo / pnpm-workspace / yarn-workspace</b></summary>

Run from the **repo root**. The CLI finds your workspaces, installs into the one bundler workspace automatically, or shows an interactive picker when several have bundlers. In CI, target one with `--cwd apps/web`. A single root lockfile is enough. Worked example: [`examples/turbo-monorepo/`](./examples/turbo-monorepo).

</details>

<details>
<summary><b>Next.js: one extra manual step</b></summary>

The CLI writes `next.config.*` and `instrumentation.ts` automatically, then prints a one-liner for `app/layout.tsx` (AST-editing user JSX is fragile, so the human places it):

```tsx
// app/layout.tsx
import { HoverScript } from '@hover-dev/next';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HoverScript />   {/* 👈 add this */}
      </body>
    </html>
  );
}
```

Works on Next 15 + 16, Turbopack or webpack. See the [Next install guide](https://gethover.dev/docs/get-started/install#next-js-15-16).

</details>

### 3 · Start your dev server

Run your dev server as you already do (`pnpm dev` / `npm run dev` / …) and open the dev URL in any Chrome. A floating ✨ launcher appears bottom-right:

- 🔵 **Blue** — a debug Chrome is wired up. Click and start chatting.
- 🟠 **Amber** — no debug Chrome yet. Click; Hover spawns an isolated one on port 9222 (clean profile under `<tmpdir>/hover-chrome`), navigated to your dev URL. Switch over and click ✨ again.
- ⚪ **Gray** — a debug Chrome is running, but you're not in it. Click to bring it to the front.

Want Hover to pre-warm the debug Chrome at `pnpm dev`? Pass `autoLaunchChrome: true`. Then type — or hold 🎙 and speak — your first prompt:

```
log in, then add a todo named "verify hover"
```

Click **Save as spec** and the verified flow becomes a `__vibe_tests__/<slug>.spec.ts` that runs in CI like any other Playwright test.

## Use it in your project

The CLI handles install + config. To wire it manually, here's the shape per bundler.

**Vite** (React / Vue / Svelte / Solid / Qwik):

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { hover } from 'vite-plugin-hover';

export default defineConfig({
  plugins: [
    /* your framework plugin: react() / vue() / svelte() / … */
    hover(),                 // 👈 add this line
  ],
});
```

**Astro 5+** — its own integration (Astro's HTML pipeline bypasses Vite's `transformIndexHtml`):

```ts
import hover from '@hover-dev/astro';
export default defineConfig({ integrations: [hover()] });
```

**Nuxt 4+** — a Nitro module (Nuxt renders HTML through Nitro, not Vite):

```ts
export default defineNuxtConfig({ modules: ['@hover-dev/nuxt'] });
```

**Next.js 15 + 16** (App Router) — three pieces, `next.config.{ts,mjs,js}`, Turbopack or webpack:

```ts
// next.config.ts
import { withHover } from '@hover-dev/next';
export default withHover({ /* your Next config */ });
```

```ts
// instrumentation.ts
export { register } from '@hover-dev/next/instrumentation';
```

```tsx
// app/layout.tsx — render {children} then <HoverScript /> inside <body>
import { HoverScript } from '@hover-dev/next';
```

**Webpack 5** (vanilla `webpack-dev-server`, Rspack, Rsbuild, legacy CRA / Vue CLI):

```js
const Hover = require('webpack-plugin-hover');
module.exports = { plugins: [new Hover()] };
```

**Optional: Security mode** — Vite / Astro / Nuxt / Webpack take the plugin as an extra argument to `hover()`:

```ts
import { hover } from 'vite-plugin-hover';
import securityMode from '@hover-dev/security';
export default defineConfig({ plugins: [hover({}, securityMode())] });
```

For Next.js, pass plugins to `register()` as module-specifier strings, which keeps Node-only plugin deps out of the Edge bundle:

```ts
// instrumentation.ts
import { register as registerHover } from '@hover-dev/next/instrumentation';
export async function register() {
  await registerHover({}, ['@hover-dev/security']);
}
```

Verified specs land in `__vibe_tests__/` at your project root. Run them with `npx playwright test` — they import only `@playwright/test` and have no runtime dependency on Hover.

## Plugin options

```ts
hover({
  port: 51789,             // local WebSocket port; auto-bumps if taken
  enabled: true,           // false to disable (default: only in dev mode)
  chromeDebugPort: 9222,
  agentId: 'claude',       // matches @hover-dev/core's agent registry
  model: 'sonnet',         // 'opus' costs ~5× — use sonnet for browser driving
  maxBudgetUsd: undefined, // hard $ ceiling per agent invocation
  sourceAttribution: true, // stamps data-hover-source="file:line:col" on host JSX; dev-only
});
```

## How it works

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Widget        │ ───────────────────▶ │  @hover-dev/core │
│  (Shadow DOM,  │ ◀─────────────────── │  Node service    │ ◀── plugins
│   in dev page) │   step events        │  (127.0.0.1)     │     (mode, MCPs,
└────────────────┘                      └────────┬─────────┘      Chrome flags)
                                                 │ spawn
                                                 ▼
                                        ┌──────────────────┐
                                        │  claude / codex  │
                                        │  --strict-mcp,   │
                                        │  --allowedTools  │
                                        │  mcp__playwright │
                                        │  mcp__<plugin>__*│
                                        └─────┬────────┬───┘
                                              │ MCP    │ MCP
                                              ▼        ▼
                                  ┌─────────────────┐  ┌────────────────────┐
                                  │ Playwright MCP  │  │ Plugin MCP server  │
                                  └────────┬────────┘  │ (flows / replay /  │
                                           │ CDP       │  inspect)          │
                                           ▼           └────────────────────┘
                                  ┌────────────────────────────────────────┐
                                  │  Isolated debug Chrome (port 9222),     │
                                  │  via your <tmpdir>/hover-chrome profile │
                                  └────────────────────────────────────────┘
```

The plugin slot lets optional packages like [`@hover-dev/security`](./packages/security/) extend the agent's tool surface without touching `@hover-dev/core`. Architecture details and the plugin API live on the [docs site](https://gethover.dev/docs/development/).

## FAQ

### My UI changed and my saved spec breaks. What now?

**Most UI churn doesn't break it** — Hover generates `getByRole / getByLabel / getByText` semantic selectors, not CSS or XPath. When the *semantics* shift (button renamed, role changed), the spec turns red and you have three options: **⟳ Re-record** (the agent replays the spec's `Original prompt:` against the current UI and rewrites selectors — ~30 s, ~$0.10), **edit by hand** (it's plain Playwright), or **treat it as a real regression** if the flow itself broke. We don't auto-heal at CI time on purpose: that keeps CI deterministic and free, and concentrates LLM cost into deliberate one-off re-records.

### Does Hover send my source or DOM to a hosted service?

No. Hover spawns the coding-agent CLI on your local `PATH`, and that CLI talks to its own provider. `@hover-dev/core` has no LLM SDK code, no telemetry, no upload path. The Node service binds to `127.0.0.1` only.

### Will it spawn another headless Chromium in CI?

No. `@hover-dev/core` launches one isolated debug Chrome under `<tmpdir>/hover-chrome` and connects via CDP. CI tests run with whatever browsers `@playwright/test` is configured with — entirely separate.

### Why doesn't the widget show up in production builds?

All integrations are dev-only (`apply: 'serve'` for Vite, `command === 'dev'` for Astro, etc.). Production builds are no-ops, and the Shadow-DOM widget is marked `data-hover="true"` so any Playwright run against production HTML filters it out.

### Security spec auth setup, what's the difference between a Skill and a Spec, and more

See the [docs site FAQ](https://gethover.dev/docs).

## Built on the shoulders of

- [**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) — the **Local CLI Agent First** architecture: a local daemon as the only privileged process, the coding-agent CLI as a sidecar, strict-sandbox-by-default, and a per-invocation USD cap. Open Design proved the loop for a *design* surface; Hover applies it to a *testing* surface.
- [**Playwright Codegen**](https://playwright.dev/docs/codegen) — the *deterministic spec is the artifact* posture. Hover keeps the artifact deterministic so CI never talks to a model.
- [**Stagehand**](https://github.com/browserbase/stagehand) and [**Midscene**](https://github.com/web-infra-dev/midscene) — proved an LLM can usefully drive a real browser at test time. Hover shortens the loop: the agent drives once during authoring, then steps out.

If your favourite agent isn't wired (`claude`, `codex`, `cursor-agent`, `aider`, `gemini-cli`, `qwen-code`), it's a one-file addition in [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts) — PRs welcome.

## Roadmap

Shipped (✓), newest first:

- **v0.14.x** ✓ — Single-Chrome security (resident MITM proxy, no second browser) + the gethover.dev landing site + `--mode-accent` widget theming + CJK prose output.
- **v0.13.x** ✓ — Record/replay parity: per-step visibility prelude, synthetic `page.goto`, "Reload before recording".
- **v0.12.x** ✓ — Security spec recording: `replay_flow` gains `intent` + `expectStatus`; Save-as gains a Security spec entry.
- **v0.11.x** ✓ — Spec resilience: ⟳ Re-record + Saved-sessions overlay.
- **v0.10.x** ✓ — Multi-tab / popup agent reliability + `aider` / `gemini-cli` / `qwen-code`.
- **v0.9.x** ✓ — Widget plugin-UI protocol + `cursor-agent`; `@hover-dev/security` migrates to a real widget plugin.
- **v0.8.x** ✓ — Multi-framework source attribution (`.jsx`/`.tsx`/`.vue`/`.svelte`/`.astro`) + Next plugin support.
- **v0.7.x** ✓ — Security testing + plugin API: `@hover-dev/security` MITM proxy, captured-flow inspector, `defineHoverPlugin`.
- **v0.6.x** ✓ — Voice mode (push-to-talk STT + spoken narration, browser-native, 中文 / English).
- **v0.5.x** ✓ — Merged Record + Assert sub-toolbar (`● Record / ✓ Exists / ¶ Says / = Equals`).
- **v0.4.x** ✓ — Click → Fix prompt + the Vite source-attribution transform.
- **v0.3.x** ✓ — `@hover-dev/next` Turbopack-native integration.
- **v0.2.x / v0.1.x / v0.0.1-poc** ✓ — multi-agent + dark widget v2; Vite plugin + chat UI + Save as Spec; end-to-end feasibility.

Planned:

- **Structured spec output** — planned — the saved spec grows an architecture: page objects + fixtures lifted from flows repeated across specs, `test.step` Given/When/Then reports, `Promise.all` pairing for popup / new-tab flows, and a `.hover/conventions.md` that steers the agent toward project conventions. All still plain Playwright, no agent in CI. Design in [`Harness/structured-spec-output.md`](./Harness/structured-spec-output.md).
- **Chrome extension** — planned — drops the bundler-plugin dependency so Hover can drive *any* tab (staging URLs, third-party sites). Likely a separate repo; loses source attribution, gains universal page coverage.
- **Hover Cloud** — planned — a hosted layer over the specs you author locally: intent-driven **self-heal** (re-record a CI-red spec from its original intent, open a selector-only PR), **test-rot detection** (flag specs whose intent no longer matches the live UI), and AI failure diagnosis. Authoring stays local and free; CI still runs plain Playwright. [Join the waitlist](https://gethover.dev/#cloud).

## Project status

🟢 **v0.14.0 shipped** — dogfood-ready across all five bundler integrations plus React Native Web. See the [Roadmap](#roadmap) for the per-version arc and [issues](https://github.com/Hyperyond/Hover/issues) for what's in flight. Security reports go to the [Security Policy](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR:

- Node 22+ / pnpm 10+
- Conventional Commits (enforced by `commit-msg` hook)
- `pnpm typecheck && pnpm test` before pushing
- Keep `main` runnable — speculative work on `experiment/<name>` branches

## License

[Apache-2.0](./LICENSE) © Hyperyond
