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
  <a href="https://hover-docs.vercel.app"><img alt="Documentation" src="https://img.shields.io/badge/docs-hover--docs.vercel.app-7CFFA8?style=flat-square&logo=readthedocs&logoColor=white" /></a>
  <a href="https://github.com/Hyperyond/Hover/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Hyperyond/Hover?style=flat-square&label=release&color=blueviolet" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://github.com/Hyperyond/Hover/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/Hyperyond/Hover?style=flat-square&color=2ecc71" /></a>
  <a href="https://github.com/Hyperyond/Hover/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/Hyperyond/Hover?style=flat-square&color=8e44ad" /></a>
  <a href="#how-it-works"><img alt="Local CLI Agent First" src="https://img.shields.io/badge/architecture-Local%20CLI%20Agent%20First-black?style=flat-square" /></a>
</p>

</div>

---

Open the floating chat in your dev page, describe what you want to verify in plain English, watch AI operate your app for real. When the run is clean, click **Save as spec** — Hover writes a standard `@playwright/test` file you can run in CI without an agent in the loop, forever.

**New in v0.7:** add `@hover-dev/security` and the same widget grows a **Security testing mode** — the agent inspects captured API calls and replays them with mutations to find IDOR, authz bypass, parameter tampering, and PII leakage. Findings crystallise into Playwright specs too. See [Security testing](#security-testing) below.

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
  <a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">
    <img src="https://img.youtube.com/vi/lQV5dmVWaIA/maxresdefault.jpg" alt="Hover demo — watch on YouTube" width="70%" />
  </a>
  <br/>
  <sub><b><a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">▶ Watch the demo on YouTube</a></b></sub>
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

Each of the targets below pairs a simple counter + todo smoke page with a different host bundler / framework, so each Hover integration package has a dedicated dogfood ground. The richer surfaces above (`stock-registration`, `e-commerce`, `canvas-paint`) run on Vite + React.

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

## What you get today

- **One bundler plugin per stack.** Vite, Astro, Nuxt, Next.js (Turbopack), webpack 5, and React Native Web are all covered. The plugin injects a Shadow-DOM widget into your dev page, runs as no-op in production, and is marked `data-hover="true"` so your own Playwright runs skip it.
- **🛡️ Security testing mode (NEW in v0.7).** Install `@hover-dev/security` alongside the base plugin and the widget grows a Security mode. The debug Chrome runs through a local HTTPS MITM proxy; the agent inspects captured API calls and replays them with mutations to probe for IDOR, authz bypass, parameter tampering, missing security headers, and PII leakage. Crystallises into Playwright specs that run in CI without the proxy. See [Security testing](#security-testing) below.
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
- **Record mode with built-in checks** — Toggle Record in the footer, do the flow manually, get the same step sequence as if the agent had driven it. While recording, the sub-toolbar lets you switch what the next click captures:
  - **● Record** — record the click / fill / select as a Playwright step (default)
  - **✓ Exists** — check the element appears: `expect(SEL).toBeVisible()`
  - **¶ Says** — check the element's text matches: `expect(SEL).toHaveText("…")`
  - **= Equals** — check an input / select / checkbox's current value
  Check modes are one-shot — after the click commits the assertion, you snap back to Record. The same Save card downstream takes everything: actions and checks bake into the same `.spec.ts`. The downstream save path doesn't care whether the steps came from a human or from Claude.
- **Fix prompt button** — A separate **⌖ Fix** button next to Record. Click it, click any element on the page, type *what you'd like to change*, and Hover assembles a precise prompt — source `file:line:col`, ancestor source chain, React component chain, Playwright selector, outer HTML — onto your clipboard. Paste into Cursor / Claude Code / Windsurf and the agent has exact context. See [Fix prompt](#fix-prompt) below.
- **Voice mode (push-to-talk + spoken progress).** Hold the round 🎙 button next to Send, speak your instruction (中文 or English — Hover detects), release to fire. While the agent works, key step events (`Opening page` / `Clicking …` / `Done in N steps`) get read aloud in the same language you used, so you can keep your eyes on the page under test. Pure browser-native Web Speech API — zero extra API keys, zero service-side changes. Chrome 139+ runs the recogniser on-device (SODA pack). Toggle TTS off from the new ⚙ settings panel. See [Voice mode](#voice-mode) below.
- **Session persistence + resume.** Widget state survives page reload via `localStorage`; the next prompt resumes the same `claude --session-id`.

### Bug discovery as a first-class output

The agent's verification report and any bugs it finds get their own cards at the end of the run — separate from the step-by-step timeline. The Result card holds the narrative summary (PASS / FAIL + steps the agent took); the Findings card lists every `## Bug` / `## Minor` / `## Note` the agent flagged, severity-coloured.

<p align="center">
  <img src="docs/screenshots/07-findings-card.png" alt="Findings card — bugs and minor issues the agent flagged" width="60%" />
</p>

The system prompt teaches the agent to emit this structured block at the end of every run, so QA reading the saved spec can scan the bug list without scrolling through tool calls.

### Security testing

> ⚠️ **Authorised testing only.** Hover's Security mode operates on the dev server running on your own machine. Pointing it at systems you do not own or have written authorisation to test is illegal in most jurisdictions and against the project's [Security Policy](./SECURITY.md). The agent is prompt-instructed to operate within these boundaries; you are responsible for keeping it there.

`@hover-dev/security` is Hover's first optional plugin. Install it next to the base plugin, and the widget grows a mode bar above the panel header — flip into **Security testing** and the panel border + launcher ring turn orange to signal altered state.

```bash
pnpm add -D @hover-dev/security
```

```ts
// vite.config.ts (Astro / Nuxt / Next / Webpack mirror the same pattern)
import { hover } from 'vite-plugin-hover';
import securityMode from '@hover-dev/security';

export default defineConfig({
  plugins: [hover({}, securityMode())],
});
```

Zero external dependencies — no `mitmproxy`, no Python, no system CA install. The plugin uses [mockttp](https://github.com/httptoolkit/mockttp) (the engine behind HTTP Toolkit) to MITM HTTPS, generates a one-off CA on first run, and pins it via Chrome's `--ignore-certificate-errors-spki-list` so your OS trust store stays untouched. The CA private key persists under `<project>/.hover/ca/` (the shipped `.gitignore` excludes it).

**What the agent looks for**, in priority order:

1. **Authz / authn** — IDOR (replay a captured URL with a swapped resource id), auth bypass (drop or swap the auth header), parameter tampering (mutate `user_id` / `role` / `price` / `isAdmin`), mass assignment (add `admin: true` to a POST body).
2. **Frontend** — XSS injection, open redirects, missing security headers (CSP / X-Frame-Options / HSTS / SameSite cookies).
3. **Compliance / privacy** — PII in URL query strings, cookies without `Secure / HttpOnly / SameSite`, third-party requests carrying user data before consent.

**Explicitly out of scope** — the system prompt forbids SQL injection, SSRF, command injection, deserialisation attacks, and automated fuzzing loops. Browser-driven testing can't usefully probe these classes; run a server-side scanner (`sqlmap`, ZAP, etc.) if you need them.

The agent gets four extra MCP tools while the mode is active: `list_flows` (enumerate captured API surface), `get_flow` (full headers + body), `replay_flow` (re-issue with optional method / url / headers / body mutations), and `clear_flows`. Findings save as plain Playwright specs that reproduce the probe via `page.request.fetch()` — your CI runs them with vanilla `@playwright/test`, no Hover, no mockttp.

See [docs/features/security](https://hover-docs.vercel.app/features/security) for the full walkthrough + reporting markers + honest limitations.

### Voice mode

Speak your prompt; hear the agent's progress. Hold the round 🎙 button next to Send (push-to-talk) — the icon switches to a live elapsed-seconds counter and the mint glow pulses while listening. Mid-sentence pauses don't cut you off; the recogniser stays open until you release. Speak Chinese or English — Hover detects the language from your prompt and routes both the TTS playback voice (prefers Siri / Premium / Google over legacy system voices) and the spoken step phrasing to match (`打开页面` / `点击登录按钮` / `完成，共 5 步` vs. `Opening page` / `Clicking Submit` / `Done in 5 steps`).

Three knobs worth knowing:

- **Push-to-talk only.** No always-listening mode — privacy by default, no hot-mic in your dev environment.
- **TTS on by default, one click to mute.** Open the ⚙ settings panel in the header, flip *Speech narration* off. In-flight utterances cut immediately. State persists across reloads.
- **No cloud round-trip.** Both STT and TTS use the browser's built-in Web Speech API. On Chrome 139+ the recogniser installs SODA language packs and runs on-device — audio never leaves your machine. No new API keys, no `.env` entries, no service-side changes. Firefox (no `SpeechRecognition`) sees a disabled mic button with a "use Chrome" tooltip.

Voice playback is filtered, not a fire-hose: only `tool_use` events that map to a humanised verb (`Clicking`, `Filling form`, `Switching tab`, …) get spoken; `browser_snapshot` / `browser_take_screenshot` / read-only diagnostics are deliberately silent so the ear isn't drowned in noise. The Stop button cancels any in-flight utterance the moment you press it.

### Pick your agent — claude, codex, or roll your own

The widget header shows the active agent as a pill. Click it for a dropdown of every agent in the registry, marked with what's installed on your PATH and what isn't (with copy-pasteable install hints). Switch on the fly without restarting the dev server.

<p align="center">
  <img src="docs/screenshots/08-agents-dropdown.png" alt="Agent picker dropdown — Claude Code installed, OpenAI Codex available" width="50%" />
</p>

`claude` is the recommended default (hard sandbox, MCP-only tool surface). `codex` is wired as the second-class citizen (soft sandbox — codex doesn't expose a built-in-tool deny list at the CLI level, so we lean on its `--sandbox read-only` flag + a strict `developer_instructions` prompt). The widget marks soft-sandbox agents with a ⚠ badge so you know the surface is broader.

Adding `cursor-agent` / `aider` / `gemini-cli` / your own coding-agent CLI is one file in [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts).

## Fix prompt

<p align="center">
  <img src="docs/screenshots/09-fix-prompt-comparison.png" alt="Vibe coding prompt comparison — vague natural-language ask vs. a structured, source-attributed Fix prompt" width="80%" />
</p>

The widget knows the source location of every host element on your page — a Vite transform stamps `data-hover-source="file:line:col"` onto every `<button>` / `<div>` / `<input>` you authored in JSX. Click the **⌖ Fix** button next to Record, click any element, type what you'd like to change, hit ⌘↵, and Hover assembles a precise prompt into your clipboard. Paste it into Cursor / Claude Code / Windsurf and your agent has exact context.

The prompt is **fact-only** — no leading instructions for the agent to echo back, no "please open the right file" boilerplate. Just your intent (as a markdown blockquote) followed by what Hover observed:

```
Change this element in my app:

> Make this button red and add a loading spinner on click

Element: <button> — "Add to cart"
Source of likely target: src/components/ShadcnButton.tsx:42:11
Ancestor sources (closer ancestors first):
  • <div> @ src/routes/Cart.tsx:71:6
  • <section> @ src/routes/Cart.tsx:64:4
  • <main> @ src/App.tsx:11:6
React component chain (innermost first): ShadcnButton → CartLineItem → Cart → App
Playwright selector: page.getByRole("button", { name: "Add to cart" })
Outer HTML:
  <button data-hover-source="src/components/ShadcnButton.tsx:42:11" class="btn-primary">Add to cart</button>
```

Two parts of this matter:

- **Likely-target descent** — if you click a `<div>` wrapping a button, Hover auto-points the prompt at the inner button (it's almost always what you meant). The `<div>` itself appears as "Clicked" in the prompt so the agent has both anchors.
- **Ancestor chain catches wrapper-rendered hosts** — `<StyledButton>` renders a `<button>` from inside `styled-components`' source; Hover's transform can't reach into a library, so the element's *own* source stamp would point to library internals. But the **DOM ancestor chain** still carries the user's call site — typically the `<div>` that wraps `<StyledButton>` in your component. The agent reads the chain and lands on the right file. [`examples/basic-app/src/wrapper-lab.tsx`](./examples/basic-app/src/wrapper-lab.tsx) exercises five wrapper shapes (bare host, styled-components, className-forwarding, multi-layer nested, Radix Slot/asChild) with measured findings recorded in the file header.

Clicking **Fix mid-recording is allowed** — Record pauses while the popover is open and resumes automatically when you close it (Submit or Cancel). The Record button is disabled during Fix so you can't accidentally end the paused session; Fix's Submit / Cancel is the only path back.

## Install

Three steps, all copy-paste. Detailed walkthrough in the [install docs](https://hover-docs.vercel.app/get-started/install).

### 1 · Prerequisites

- **Node 22+** on PATH.
- One coding-agent CLI installed and logged in:

  | Agent | Install + login | What it costs |
  |---|---|---|
  | Claude Code | `npm install -g @anthropic-ai/claude-code` then `claude login` | rides on your Claude Pro / Max subscription |
  | OpenAI Codex | `npm install -g @openai/codex` then `codex login` | rides on your ChatGPT plan |

  Either one works. You can switch from the widget header anytime — Hover detects both on `PATH`.

No new API keys, no `.env` file, no `.npmrc` for npm auth — all Hover packages are public on npmjs.com.

### 2 · Add Hover to your project

```bash
npx @hover-dev/cli add
```

That one command:

1. Detects your bundler from `package.json` (Vite / Astro / Nuxt / Next.js / Webpack).
2. Detects your package manager from your lockfile (pnpm / yarn / bun / npm).
3. Installs the right Hover package as a `devDependency`.
4. AST-edits your bundler config to register the plugin / integration.

It's **idempotent** — running it twice is a no-op. **Dry-run** prints what would change without touching anything:

```bash
npx @hover-dev/cli add --dry-run
```

Force a specific bundler if auto-detect picks the wrong one:

```bash
npx @hover-dev/cli add --vite      # vite-plugin-hover
npx @hover-dev/cli add --astro     # @hover-dev/astro
npx @hover-dev/cli add --nuxt      # @hover-dev/nuxt
npx @hover-dev/cli add --next      # @hover-dev/next
npx @hover-dev/cli add --webpack   # webpack-plugin-hover
```

<details>
<summary><b>Monorepo? turbo / pnpm-workspace / yarn-workspace</b></summary>

Run from the **repo root**, not from inside `apps/*`:

```bash
npx @hover-dev/cli add
```

The CLI:
- Finds your workspaces from `pnpm-workspace.yaml` / `package.json` `workspaces` / `turbo.json`
- If **exactly one** workspace has a bundler → installs there automatically
- If **multiple** workspaces have bundlers → interactive picker (↑/↓, Enter) appears, or in CI you re-run with `--cwd`:

```bash
npx @hover-dev/cli add --cwd apps/web
```

The package manager is detected by walking up to find a lockfile, so a single root `pnpm-lock.yaml` is enough — sub-workspaces don't need their own. A worked example lives under [`examples/turbo-monorepo/`](./examples/turbo-monorepo) — turbo + pnpm-workspace + two Next.js 15 apps + `next.config.ts`.

</details>

<details>
<summary><b>Next.js: one extra manual step</b></summary>

For Next, the CLI writes `next.config.*` and `instrumentation.ts` automatically but prints a one-liner for you to paste into `app/layout.tsx` — modifying user JSX with an AST is fragile, so we leave the human in charge of that one:

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

Works on **Next 15 + 16**, with both Turbopack and webpack, and any of `next.config.{ts,mjs,js}`. See the [Next install guide](https://hover-docs.vercel.app/get-started/install#next-js-15-16) for the full breakdown.

</details>

<details>
<summary><b>Prefer to wire it manually</b></summary>

```bash
pnpm add -D vite-plugin-hover     # or @hover-dev/astro / @hover-dev/nuxt / @hover-dev/next / webpack-plugin-hover
```

Then drop the plugin / integration into your bundler config — see [Use it in your project](#use-it-in-your-project) below for the per-bundler snippets.

</details>

### 3 · Start your dev server

Exactly as you already do:

```bash
pnpm dev          # or npm run dev / yarn dev / bun dev
```

Open your dev URL in **any Chrome** (your everyday browser is fine for this first step). A floating ✨ launcher appears in the bottom-right. Its colour tells you what to do next:

- 🔵 **Blue** — Hover already has a debug Chrome wired up. Click and start chatting.
- 🟠 **Amber** — no debug Chrome yet. Click the launcher; Hover spawns an **isolated debug Chrome** on port 9222 (clean profile under `<tmpdir>/hover-chrome`, completely separate from your everyday browsing), navigated to your dev URL. Switch over and click ✨ again.
- ⚪ **Gray** — a debug Chrome is running, but you're not in it right now. Click to bring it to the front.

> **Want Hover to pre-warm the debug Chrome at `pnpm dev`?** Pass `autoLaunchChrome: true` to the plugin (see [Plugin options](#plugin-options)). Prefer to start the debug Chrome by hand? `pnpm exec hover-chrome` (or `npx hover-chrome`) any time.

Type — or hold 🎙 and speak — your first prompt:

```
log in, then add a todo named "verify hover"
```

The agent drives the debug Chrome over CDP, narrates each step, and renders a Result + Findings card. Click **Save as Spec** and the verified flow becomes a `__vibe_tests__/<slug>.spec.ts` file that runs in CI like any other Playwright test — no Hover dependency, no agent in the loop, no API key.

Working **on** Hover itself (not with it)? See [Development](https://hover-docs.vercel.app/development/) on the docs site for the monorepo workflow.

## Use it in your project

The CLI handles install + config edit for you. If you prefer to wire it manually, here's the shape per bundler.

**Vite** (React / Vue / Svelte / Solid / Qwik — anything whose Vite dev server runs `transformIndexHtml`):

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

**Astro 5+** — uses its own integration because Astro's HTML pipeline bypasses Vite's `transformIndexHtml`:

```ts
import hover from '@hover-dev/astro';
export default defineConfig({ integrations: [hover()] });
```

**Nuxt 4+** — uses a Nitro module because Nuxt renders HTML through Nitro, not Vite:

```ts
export default defineNuxtConfig({ modules: ['@hover-dev/nuxt'] });
```

**Next.js 15 + 16** (App Router) — three pieces because Next's instrumentation is split. Works with `next.config.{ts,mjs,js}` on both Next 15 (webpack default) and Next 16 (Turbopack default):

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
// app/layout.tsx
import { HoverScript } from '@hover-dev/next';
// inside <body>: render {children} then <HoverScript />
```

**Webpack 5** (vanilla `webpack-dev-server`, Rspack, Rsbuild, legacy CRA / Vue CLI):

```js
const Hover = require('webpack-plugin-hover');
module.exports = { plugins: [new Hover()] };
```

**Optional: Security mode** — install alongside any of the above:

```ts
import { hover } from 'vite-plugin-hover';
import securityMode from '@hover-dev/security';
export default defineConfig({
  plugins: [hover({}, securityMode())],
});
```

Verified specs you save via the widget land in `__vibe_tests__/` at your project root. Run them with `npx playwright test` — they import only `@playwright/test` and have no runtime dependency on Hover, so CI runs them with the widget completely disabled.

## Plugin options

```ts
hover({
  port: 51789,             // local WebSocket port; auto-bumps if taken
  enabled: true,           // false to disable (default: only in dev mode)
  chromeDebugPort: 9222,
  agentId: 'claude',       // matches @hover-dev/core's agent registry
  model: 'sonnet',         // 'opus' costs ~5× — use sonnet for browser driving
  maxBudgetUsd: undefined, // hard $ ceiling per agent invocation; no default — use Stop in the widget
  sourceAttribution: true, // stamps data-hover-source="file:line:col" on host JSX elements;
                           // dev-only — set false to disable if another tool conflicts
});
```

<!-- Example apps belong to contributors who clone the monorepo, not to users
     installing Hover from npm. The list lives at docs/development/running-examples
     so users reading this README aren't asked to context-switch into the
     monorepo. The four "testing surfaces" cards higher up cover the user-facing
     showcase. -->


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
                                  └────────┬────────┘  │ (e.g. flows /      │
                                           │           │  replay / inspect) │
                                           │           └─────────┬──────────┘
                                           │                     │ HTTP
                                           │                     ▼
                                           │           ┌─────────────────────┐
                                           │           │  Plugin control     │
                                           │           │  plane (in core)    │
                                           │           └─────────┬───────────┘
                                           │ CDP                 │ proxy
                                           ▼                     ▼
                                  ┌────────────────────────────────────────┐
                                  │  Isolated debug Chrome (port 9222 or   │
                                  │  9333 for security mode), via your    │
                                  │  /tmp/hover-chrome profile dir         │
                                  └────────────────────────────────────────┘
```

The plugin slot is what makes optional packages like [`@hover-dev/security`](./packages/security/) extend the agent's tool surface without touching `@hover-dev/core`. See [Plugin API](https://hover-docs.vercel.app/reference/plugin-api) for the manifest shape.

Architecture details, package boundaries, and contribution workflow live on the [docs site](https://hover-docs.vercel.app/development/).

## Built on the shoulders of

- [**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) — the **Local CLI Agent First** architecture. Hover doesn't bundle any AI runtime; it `PATH`-scans for whatever coding-agent CLI the developer already has installed (`claude`, today) and treats it as a sidecar. The "local daemon as the only privileged process, agent-as-teammate" worldview, the strict-sandbox-by-default posture, and the per-invocation USD budget cap are all direct inspirations. Open Design proved the loop end-to-end for a *design* surface; Hover applies it to a *testing* surface, with the deterministic Playwright spec as the artifact instead of an HTML/PDF.
- [**Playwright Codegen**](https://playwright.dev/docs/codegen) — the *deterministic spec is the artifact* posture. AI authors are fashionable; AI runtime in CI is a recurring mistake. Hover keeps the artifact deterministic so CI never has to talk to a model.
- [**Stagehand**](https://github.com/browserbase/stagehand) and [**Midscene**](https://github.com/web-infra-dev/midscene) — proved that an LLM can usefully drive a real browser at test time. Hover takes the same loop and shortens it: agent drives the browser **once** during authoring, then steps out.

If your favourite agent (`codex`, `cursor-agent`, `aider`, `gemini`, `qwen-code`, …) isn't yet supported, it's a one-file addition in [`packages/core/src/agents/registry.ts`](./packages/core/src/agents/registry.ts) — PRs warmly welcome.

## Roadmap

- **v0.0.1-poc** — Phase 0 — end-to-end feasibility (`claude -p` drives Chrome via CDP) ✓
- **v0.1.x** — Phase 1 — Vite plugin + chat UI + persistent service + Save as Spec ✓
- **v0.2.x** — Phase 2 — multi-agent (claude + codex), dark widget v2, Result + Findings cards, custom tooltip, code-quality pass ✓
- **v0.3.x** — **`@hover-dev/next` — Next.js 16+ Turbopack-native integration** ✓. Three pieces — `withHover(nextConfig, opts)` wrapper for `next.config.mjs`, a `<HoverScript />` Server Component for `app/layout.tsx`, and a `register()` helper for `instrumentation.ts`. The existing `webpack-plugin-hover` only covers `next dev --webpack`; this package is the Turbopack-native path. `npx @hover-dev/cli add` routes Next projects here automatically.
- **v0.4.x** — **Click → Suggest fix prompt.** ✓ Independent footer Fix button + element picker + intent popover + clipboard handoff. A Vite transform stamps `data-hover-source="file:line:col"` on every host JSX element (React 19 compatible — runs `enforce: 'pre'` so it sees JSX before `@vitejs/plugin-react` collapses it). React component chain comes from `_debugOwner`. Vue / Svelte source-attribution is planned but not yet shipped.
- **v0.5.x** — **Merged Record + Assert workflow.** ✓ Record mode contains a sub-toolbar with four modes: `● Record / ✓ Exists / ¶ Says / = Equals`. Check sub-modes are one-shot and follow Playwright codegen's pattern. Record and Fix coexist via pause-insert-resume.
- **v0.6.x** — **Voice mode** ✓. Push-to-talk speech input + spoken progress narration, fully browser-native (Web Speech API). 中文 / English autodetect across STT, TTS phrasing, and voice picker. Chrome 139+ runs the recogniser on-device via SODA. Settings panel (⚙ in the header) lets the user mute narration.
- **v0.7.x** — **Security testing + plugin API.** ✓ **(you are here)** `@hover-dev/security` ships as the first optional plugin: HTTPS MITM proxy (mockttp, no Python / system CA), captured-flow inspector in the widget, MCP server giving the agent `list_flows / get_flow / replay_flow / clear_flows`, system prompt scoped to authz / frontend / compliance vulnerability classes. The plugin API behind it — `defineHoverPlugin` + declarative manifest + namespaced hooks — lets third-party packages contribute modes, MCP servers, Chrome flags, and prompt fragments without touching `@hover-dev/core`.
- **v0.8.x** — planned — **multi-tab / cross-origin polish + more agents + Chrome extension.**
  - Multi-tab / cross-origin flows (Stripe, OAuth, "Pay with PayHover") — `examples/payment-provider` already stresses the `window.open` → `postMessage` path, but the agent's handling of `browser_tabs(list/select)` is brittle in the wild.
  - More agents wired into the [registry](./packages/core/src/agents/registry.ts) — `cursor-agent` / `aider` / `gemini-cli` / `qwen-code`.
  - Chrome extension (drops the Vite-plugin dependency for non-Vite stacks).
- **v0.9.x** — planned — **Recording semantics for security mode.** Re-purpose the Record button while a security mode (or future probing mode) is active so a session captures the agent's replay decisions + asserts the server response shape, crystallising into a security regression spec.

v0.7.x is what you can use today.

## Project status

🟢 **v0.7.0 shipped.** Dogfood-ready across all six host bundlers: Vite, Astro, Nuxt, Next.js (Turbopack), webpack 5, and React Native Web. v0.7 introduces a plugin API and ships `@hover-dev/security` as the first optional plugin — HTTPS MITM proxy, captured-flow inspector, agent-driven IDOR / authz / parameter tampering probes, crystallising into Playwright regression specs. Earlier arcs: v0.6 (Voice mode — push-to-talk STT + spoken step narration, browser-native Web Speech API), v0.5 (Record + Exists / Says / Equals sub-toolbar), v0.4 (Click → Fix prompt + Vite source-attribution transform), v0.3 (Next.js Turbopack-native integration).

Tracking issues at [github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues). Security reports go to the [Security Policy](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR:

- Node 22+ / pnpm 10+
- Conventional Commits (enforced by `commit-msg` hook)
- `pnpm typecheck && pnpm test` before pushing
- Keep `main` runnable — speculative work on `experiment/<name>` branches

## License

[Apache-2.0](./LICENSE) © Hyperyond
