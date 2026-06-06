<div align="center">

# Hover

<img src="docs/assets/banner.png" alt="Hover — the local-first, open-source way to author end-to-end tests with AI" width="100%" />

<p>
  <b>English</b> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/cli"><img alt="@hover-dev/cli on npm" src="https://img.shields.io/npm/v/@hover-dev/cli?style=flat-square&label=npx%20%40hover-dev%2Fcli%20setup&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@hover-dev/core"><img alt="@hover-dev/core on npm" src="https://img.shields.io/npm/v/@hover-dev/core?style=flat-square&label=%40hover-dev%2Fcore&color=cb3837&logo=npm&logoColor=white" /></a>
  <a href="https://github.com/Hyperyond/Hover/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Hyperyond/Hover?style=flat-square&color=ffd700" /></a>
  <a href="https://gethover.dev/docs"><img alt="Documentation" src="https://img.shields.io/badge/docs-gethover.dev-7CFFA8?style=flat-square&logo=readthedocs&logoColor=white" /></a>
</p>

<p>Open a chat in your dev page, describe a flow in plain English, watch AI drive your real app — then click <b>Save as spec</b> for a standard <code>@playwright/test</code> file that runs in CI with no agent, no model, no key.</p>

</div>

<p align="center">
  <a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">
    <img src="https://img.youtube.com/vi/lQV5dmVWaIA/maxresdefault.jpg" alt="Hover demo — watch on YouTube" width="80%" />
  </a>
  <br/>
  <sub><b><a href="https://www.youtube.com/watch?v=lQV5dmVWaIA">▶ Watch the 2-minute demo</a></b></sub>
</p>

Hover drives your app once to explore, then crystallises the verified run into a deterministic spec. From there an optional **AI optimisation pass** polishes it — adding the success/error assertions the run actually observed, completing popup / download flows, flagging buggy behaviour with `// KNOWN BUG` — into a candidate you review by diff, with the deterministic original always kept.

**Bring your own CLI — subscription *or* API key.** Hover spawns the coding-agent CLI already on your `PATH` (`claude` / `codex` / …). Ride the subscription you already pay for, or drop your own model API key into the widget (it's passed to the CLI's environment, stored only in your browser, never uploaded). Either way the LLM cost is a one-off at authoring time — never a recurring tax on green builds, since the saved `.spec.ts` runs forever with `npx playwright test`, no agent in the loop.

## Why Hover

Several good tools exist here; Hover is what falls out when you optimise for **artifact portability**.

| Tool | What it does | The trade-off |
|---|---|---|
| **Playwright Codegen** | Records your clicks → `.spec.ts`. No AI | Can't think — replays literally |
| **Stagehand / Midscene** | AI-augmented tests; caches skip the LLM on steady-state runs. Needs an OpenAI / Anthropic key | Tests run **inside the vendor SDK** + cache file — not portable to a plain Playwright runner |
| **Hover** | AI drives the browser **once** to explore, saves a deterministic spec — with an optional AI pass that polishes it into a diff-reviewed candidate — *and* a Jira-importable case. **Spawns the CLI on your `PATH`** — subscription or your own API key | Crystallised spec is brittle to UI change — when it breaks, re-run the agent (no self-heal at CI time) |

Hover isn't trying to be the better *test-time* AI runtime. It makes the saved artifact plain `@playwright/test` code that runs with zero AI deps: the agent's job ends at "save", and CI is pure Playwright — **zero tokens, no key wired into CI**.

### Crystallise two ways

A single **💾 Save as ▾** on the done card crystallises one verified session two ways — every file checks into git, readable by teammates who never install Hover.

| | `📜 .spec.ts` | `📋 .case.csv` |
|---|---|---|
| **Lands in** | `__vibe_tests__/` | `__vibe_tests__/` |
| **Read by** | Node + Playwright (CI) | Xray · Zephyr · Jira |
| **Audience** | CI, devs | QA · PM |
| **Determinism** | Hard contract | Manual review |

<p align="center">
  <img src="docs/screenshots/05-save-dropdown.png" alt="Save dropdown — Playwright spec, Jira test case (CSV)" width="48%" />
  <img src="docs/screenshots/06-jira-case-modal.png" alt="Save as Jira case modal" width="48%" />
</p>

## What you get

- **Five bundler integrations** — Vite, Astro, Nuxt, Next.js (Turbopack), webpack 5; React Native Web rides on `vite-plugin-hover`. A Shadow-DOM widget injects into your dev page, is a no-op in production, and is marked `data-hover="true"` so your own Playwright runs skip it.
- **Your subscription or your API key** — spawns whichever coding-agent CLI is on your `PATH`, on the subscription you logged in with or a model API key you paste into the widget (kept in your browser, injected into the CLI's env, never uploaded). `@hover-dev/core` ships zero LLM SDK code — there's no model client to send a key to in the first place.
- **Six agents, per-agent sandbox** — `claude` (hard sandbox, recommended), `codex`, `cursor-agent`, `aider`, `gemini-cli`, `qwen-code`. Hard-sandbox agents can reach only Playwright MCP, with a `--max-budget-usd` ceiling; soft-sandbox agents carry a ⚠ badge.
- **Structured spec output** — Page Objects + fixtures lifted from repeated flows, `test.step(...)` blocks, a `.hover/<slug>.json` sidecar per spec, and `Promise.all` popup/new-tab pairing. An optional, off-by-default **AI optimisation pass** polishes a deterministic draft into a candidate you accept via diff (original always kept; buggy behaviour flagged inline `// KNOWN BUG`), learning from a **seed library** (`.hover/rules/`, community-extensible). `.hover/conventions.md` steers house style; exploration scope matches how specific your prompt is.
- **Resilience + bug discovery** — visibility-guarded selectors fail loudly, not on a 30 s timeout; **⟳ Re-record** replays a spec's original prompt to rewrite selectors; the agent's `## Findings` land in a severity-coded card.
- **Record mode, voice mode, ⌖ Fix prompt, security testing** — drive by hand and get the same spec; push-to-talk prompts (中文 / English); click any element → a source-attributed fix prompt on your clipboard; an optional MITM-proxy [security plugin](https://gethover.dev/docs/features/security). Details on the [docs site](https://gethover.dev/docs).

<p align="center">
  <img src="docs/screenshots/07-findings-card.png" alt="Findings card — severity-coded bugs the agent flagged" width="48%" />
  <img src="docs/screenshots/09-fix-prompt-comparison.png" alt="Vague ask vs. a structured, source-attributed Fix prompt" width="48%" />
</p>

## Quickstart

```bash
npx @hover-dev/cli setup        # detects bundler + package manager, wires config (idempotent; --dry-run to preview)
```

You also need **Node 22+** and one coding-agent CLI — Claude Code (`npm i -g @anthropic-ai/claude-code`) or OpenAI Codex (`npm i -g @openai/codex`). Authenticate either with the subscription you already pay for (`claude login` on Pro/Max, `codex login` on your ChatGPT plan) **or** paste a model API key into the widget's ⚙ settings (it's injected into the CLI's environment, kept in your browser only). Then start your dev server as usual and open the dev URL in Chrome — a floating ✨ launcher appears bottom-right; click it (it spawns an isolated debug Chrome on demand), type a prompt, and **Save as spec**:

```
log in, then add a todo named "verify hover"
```

The verified flow becomes `__vibe_tests__/<slug>.spec.ts` — plain Playwright, no Hover runtime dependency. Manual wiring, monorepos, the Next.js step, and security mode: see the [install docs](https://gethover.dev/docs/get-started/install).

## CLI

Everything runs through the `hover` CLI (`npx @hover-dev/cli <command>`):

| Command | What it does |
|---|---|
| `setup` | Detect your bundler + package manager, install the integration, wire the config |
| `run "<prompt>"` | Drive the debug Chrome from the terminal — no widget; `--save <slug>` crystallizes a spec |
| `optimize <spec>` | Optional AI pass → an improved spec candidate (diff, original kept) |
| `extract` | Lift flows repeated across specs into shared Page Objects + fixtures |
| `re-record <spec>` | Regenerate a spec against the current UI |

`run` is CLI-only authoring (needs just `@hover-dev/core`, no widget); the rest post-process saved specs. Full reference: [docs](https://gethover.dev/docs/reference/cli).

## Examples

Ten runnable apps under [`examples/`](./examples/). Four stress **testing surfaces** ([`basic-app`](./examples/basic-app), [`stock-registration`](./examples/stock-registration) ~50-field form, [`e-commerce`](./examples/e-commerce) cart/checkout, [`canvas-paint`](./examples/canvas-paint) DOM-amid-canvas); the rest are dedicated **bundler dogfood grounds**:

| Example | Bundler / framework | Hover package |
|---|---|---|
| [`astro-app`](./examples/astro-app) | Astro 5 (`astro dev`) | [`@hover-dev/astro`](./packages/astro-integration/) |
| [`nuxt-app`](./examples/nuxt-app) | Nuxt 4 SSR (`nuxt dev`) | [`@hover-dev/nuxt`](./packages/nuxt-integration/) |
| [`next-app`](./examples/next-app) | Next.js 16 App Router (Turbopack) | [`@hover-dev/next`](./packages/next-integration/) |
| [`webpack-app`](./examples/webpack-app) | webpack 5 + `webpack-dev-server` | [`webpack-plugin-hover`](./packages/webpack-plugin/) |
| [`rn-web-app`](./examples/rn-web-app) | React Native **Web** (Vite alias) | [`vite-plugin-hover`](./packages/vite-plugin/) |

**React Native:** only the **Web** target (it compiles to DOM). Native iOS / Android is out of scope — use Maestro / Detox / Appium.

## How it works

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Widget        │ ───────────────────▶ │  @hover-dev/core │
│  (Shadow DOM,  │ ◀─────────────────── │  Node service    │ ◀── plugins
│   in dev page) │   step events        │  (127.0.0.1)     │     (mode, MCPs)
└────────────────┘                      └────────┬─────────┘
                                                 │ spawn (sandboxed)
                                                 ▼
                                  claude / codex ── MCP ──▶ Playwright ── CDP ──▶
                                  isolated debug Chrome (port 9222, tmp profile)
```

Hover spawns the coding-agent CLI on your `PATH`, sandboxed to Playwright MCP, driving an isolated debug Chrome over CDP — never your main profile, never a hosted service (`@hover-dev/core` binds `127.0.0.1` only, has no LLM SDK and no telemetry). The plugin slot lets packages like [`@hover-dev/security`](./packages/security/) extend the tool surface. Architecture + plugin API: [docs](https://gethover.dev/docs/development/).

## FAQ

**My UI changed and my saved spec breaks.** Most UI churn doesn't — selectors are `getByRole / getByLabel / getByText`, not CSS/XPath. When semantics shift, the spec turns red: **⟳ Re-record** (agent replays the original prompt, ~30 s ~$0.10), edit by hand (it's plain Playwright), or treat it as a real regression. No CI-time auto-heal on purpose — CI stays deterministic and free.

**Does Hover upload my source or DOM?** No. The CLI on your `PATH` talks to its own provider; `@hover-dev/core` has no upload path, no telemetry, binds `127.0.0.1`. More: [docs FAQ](https://gethover.dev/docs).

## Roadmap

**Landed on `main` (shipping next release):** Structured spec output — Page Objects + fixtures, `test.step` blocks, sidecars, popup pairing, the off-by-default AI optimisation pass (with `// KNOWN BUG` flagging), the `.hover/rules/` seed library, and prompt-scoped exploration.

**Planned:** **Chrome extension** (drive any tab, drops the bundler-plugin dependency) · **Hover Cloud** (hosted layer over local specs: intent-driven self-heal, test-rot detection, AI failure diagnosis — authoring stays local and free). [Join the waitlist](https://gethover.dev/#cloud).

<details>
<summary>Shipped (✓), newest first</summary>

- **v0.14.x** — Single-Chrome security (resident MITM proxy) + gethover.dev site + `--mode-accent` theming + CJK prose.
- **v0.13.x** — Record/replay parity: per-step visibility prelude, synthetic `page.goto`.
- **v0.12.x** — Security spec recording (`replay_flow` gains `intent` + `expectStatus`).
- **v0.11.x** — Spec resilience: ⟳ Re-record + Saved-sessions overlay.
- **v0.10.x** — Multi-tab / popup reliability + `aider` / `gemini-cli` / `qwen-code`.
- **v0.9.x** — Widget plugin-UI protocol + `cursor-agent`.
- **v0.8.x** — Multi-framework source attribution + Next plugin support.
- **v0.7.x** — Security testing + plugin API (`defineHoverPlugin`).
- **v0.6.x** — Voice mode (push-to-talk STT + spoken narration).
- **v0.5.x** — Merged Record + Assert sub-toolbar.
- **v0.4.x** — Click → Fix prompt + Vite source-attribution transform.
- **v0.3.x** — `@hover-dev/next` Turbopack-native integration.
- **v0.2.x / v0.1.x / v0.0.1-poc** — multi-agent + dark widget; Vite plugin + chat UI + Save as Spec; feasibility.

</details>

## Built on the shoulders of

[**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) (the **Local CLI Agent First** architecture), [**Playwright Codegen**](https://playwright.dev/docs/codegen) (deterministic-spec-as-artifact), and [**Stagehand**](https://github.com/browserbase/stagehand) / [**Midscene**](https://github.com/web-infra-dev/midscene) (proved an LLM can drive a real browser). Hover shortens the loop: drive once at authoring, then step out.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): Node 22+ / pnpm 10+, Conventional Commits (enforced), `pnpm typecheck && pnpm test` before pushing, keep `main` runnable. New agents are a one-file addition in [`registry.ts`](./packages/core/src/agents/registry.ts) — PRs welcome.

## License

[Apache-2.0](./LICENSE) © Hyperyond
