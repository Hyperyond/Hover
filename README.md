# Hover — Vibe-test your app, ship real Playwright specs.

**English** · [简体中文](./README.zh-CN.md)

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/hyperyond.hover-dev?label=VS%20Marketplace&color=1f9cf0&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/hyperyond.hover-dev?label=installs&color=1f9cf0)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)
[![Rating](https://img.shields.io/visual-studio-marketplace/stars/hyperyond.hover-dev?label=rating)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev&ssr=false#review-details)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Playwright](https://img.shields.io/badge/output-%40playwright%2Ftest-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**Hover's AI tests your app like a real teammate and ships a real Playwright spec — a local-first, open-source VS Code extension.** Describe a flow in plain English; Hover spawns the coding-agent CLI you already run (Claude Code / OpenAI Codex / Gemini / Qwen, or a local model) to drive your real Chrome via Playwright MCP, then crystallizes clean runs into plain `@playwright/test` specs that pass CI with **zero AI**. Or switch to 🟢 **QA Testing** — the agent explores your whole app on its own, writes a findings report, and layers **API** and **penetration** testing on as toggles. ✦ optional AI optimize pass.

## Install

Install **[Hover from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)** — open the Extensions view, search **`hover-dev`**, and click Install (or run `code --install-extension hyperyond.hover-dev`).

You also need **one coding-agent CLI** on your `PATH`: [Claude Code](https://claude.com/claude-code) (`npm i -g @anthropic-ai/claude-code`) or [OpenAI Codex](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with your subscription or your own API key. That's the only thing to configure — Hover ships no model SDK and no keys of its own.

## What you get

- **Chat to a real Playwright spec** — Describe what you want to verify in plain English; Hover drives your real app and crystallizes the verified run into a plain `@playwright/test` spec (`getByRole / getByLabel`, not CSS/XPath). The AI's job ends at "save" — CI is pure Playwright, with zero tokens and no key wired in.
- **Tests like a real teammate** — When the agent hits something it can't safely decide (which account to use, an ambiguous step, a destructive action), it asks you right in the editor instead of guessing or stalling. Human-in-the-loop, the way a coworker checks in.
- **Multi-environment accounts, `@`-mentionable** — Define test accounts per environment (local / staging / prod) once, then just mention `@account` in chat — the agent logs in for you. Credentials are parameterized into `process.env` references: never written into the spec, the JSDoc, or the sidecar, and the same names export to your CI secrets in one click.
- **Your model — Local CLI or BYOK** — Two ways to provide a model, switchable in Settings. *Local CLI*: drive runs with a coding-agent CLI on your PATH (Claude Code, Codex, Gemini, Qwen) on the subscription you already pay for. *BYOK*: bring your own API key — pick a protocol (Anthropic / OpenAI / Azure OpenAI / Gemini) or an OpenAI-compatible gateway (Ollama Cloud, AIHubMix, …), and Hover injects the key + base URL + model into the matching CLI. Either can point at a self-hosted endpoint for a local model. Keys live in VS Code SecretStorage. No SDK, nothing leaves your computer (`@hover-dev/core` binds `127.0.0.1`, no telemetry, no upload path).
- **Nothing new to learn** — The chat looks and works like Claude Code or Codex, so there's no new tool to learn. Install it, open the panel, describe a flow. No setup in your app, no bundler plugin, no config.
- **QA Testing — explore, don't just script** — Switch from Flow (author one spec) to 🟢 **QA Testing**: the agent autonomously explores your app to find defects, paces itself by an intensity budget (Quick / Standard / Deep), writes a Markdown findings report with a coverage map, and offers each clean flow it completes as a one-click "Crystallize" spec. Two capability toggles ride on top: **API testing** (auth / status codes / access control / IDOR / broken authorization, via a local HTTPS MITM that replays captured API calls with mutations → `.api-test.spec.ts` CI gates) and **Penetration testing** (offensive, white-box: SQLi / XSS / SSTI / SSRF / open-redirect / IDOR against your **own** app — destructive, so it runs as a separate second pass, off by default). It remembers business rules it confirms so neither it nor a future run re-asks. No mitmproxy, no Python, no system CA.
- **Deterministic, portable specs** — Every spec is plain Playwright that checks into git and runs without Hover. An optional, off-by-default **AI optimize pass** polishes a draft into a candidate you accept via diff (original always kept).

## How it works

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Hover         │ ───────────────────▶ │  @hover-dev/core │
│  (VS Code      │ ◀─────────────────── │  Node engine     │ ◀── plugins
│   extension)   │   step events        │  (127.0.0.1)     │     (mode, MCPs)
└────────────────┘                      └────────┬─────────┘
                                                 │ spawn (sandboxed)
                                                 ▼
                                  claude / codex ── MCP ──▶ Playwright ── CDP ──▶
                                  isolated debug Chrome (port 9222, tmp profile)
```

The engine ships inside the extension and spawns the coding-agent CLI on your `PATH`, sandboxed to Playwright MCP, driving an isolated debug Chrome over CDP — never your main profile, never a hosted service.

## Run specs in CI

Crystallized specs are plain `@playwright/test` — they run anywhere with no AI:

```bash
npx playwright test __vibe_tests__
```

Point them at any environment with `BASE_URL` (and the `HOVER_<LABEL>_*` account secrets); the same spec runs against local, staging, or a PR preview. Hover can generate a GitHub Actions workflow that runs them on every PR.

## Modes

Two modes in the same chat:

| Mode | What it does |
|---|---|
| **Flow** | Describe a flow; the AI drives your app and crystallizes the verified run → a `.spec.ts` you run in CI |
| 🟢 **QA Testing** | Autonomously explores the whole app → a findings report (+ coverage map) and promotable ✨ specs, bounded by an intensity budget (Quick / Standard / Deep) |

QA Testing has two **capability toggles**:

- 🟠 **API testing** — MITM-replay auth-bypass / IDOR / broken-authz / parameter-tampering; confirmed findings → `.api-test.spec.ts` CI gates.
- 🔴 **Penetration testing** — offensive, white-box (SQLi / XSS / SSTI / SSRF / IDOR) on your **own** app → a findings report. Destructive, so it always runs as a separate second pass; off by default (enabling it asks for confirmation).

The API + Penetration capabilities run off a built-in **probe catalogue** — small recipes covering 8 access-control + 9 vulnerability classes, curated and shipped with Hover.

## Examples

Runnable apps under [`examples/`](./examples/) stress different testing surfaces — `basic-app` (login / counter / todos), `stock-registration` (~50-field form), `e-commerce` (cart / checkout with a cross-tab payment popup), `canvas-paint` (DOM controls amid a canvas), and `payment-provider` (the unintegrated third-party popup target). They're plain Vite + React apps — the extension drives them over CDP, nothing to install in the app.

## FAQ

**My UI changed and my saved spec breaks.** Most UI churn doesn't — selectors are semantic, not CSS/XPath. When semantics shift, edit the spec by hand (it's plain Playwright) or treat it as a real regression. No CI-time auto-heal on purpose — CI stays deterministic and free. Automatic on-failure self-heal of UI-drifted specs is coming via **Hover Cloud**, not the local extension (which stays purely author + run).

**Does Hover upload my source or DOM?** No. The CLI on your `PATH` talks to its own provider; `@hover-dev/core` has no upload path, no telemetry, binds `127.0.0.1`.

## Roadmap

**Planned — Hover Cloud:** a hosted layer over your local specs (parallel runs, scheduled monitoring, a flakiness dashboard, on-failure AI self-heal of UI-drifted specs). Authoring stays local and free; the cloud only ever *runs and monitors* the specs you already own. [Join the waitlist](https://gethover.dev/#cloud).

## Built on the shoulders of

[**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) (the **Local CLI Agent First** architecture), [**Playwright**](https://playwright.dev/) + its [**Codegen**](https://playwright.dev/docs/codegen), [**Stagehand**](https://github.com/browserbase/stagehand) / [**Midscene**](https://github.com/web-infra-dev/midscene) (proved an LLM can drive a real browser), and [**`microsoft/webwright`**](https://github.com/microsoft/webwright) (code-as-action). Hover shortens the loop: drive once at authoring, then step out.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): Node 22+ / pnpm 10+, Conventional Commits (enforced), `pnpm typecheck && pnpm test` before pushing, keep `main` runnable.

## License

[Apache-2.0](./LICENSE) © Hyperyond
