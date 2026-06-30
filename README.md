# Hover — open-source Vibe Testing suite

**English** · [简体中文](./README.zh-CN.md)

[![npm @hover-dev/mcp](https://img.shields.io/npm/v/%40hover-dev%2Fmcp?label=npm%20%40hover-dev%2Fmcp&color=cb3837&logo=npm)](https://www.npmjs.com/package/@hover-dev/mcp)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/hyperyond.hover-dev?label=VS%20Marketplace&color=1f9cf0&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Playwright](https://img.shields.io/badge/output-%40playwright%2Ftest-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**Point the coding agent you already run at Hover, and get a real Playwright test suite you own.** Hover is an open-source **Vibe Testing** suite: add its MCP server to your own agent (Claude Code, Cursor, …) and the agent explores your app, maps its business flows, and crystallizes each one into a plain `@playwright/test` spec under `__vibe_tests__/`. The saved tests are **yours** — they run in your CI with **zero AI** in the loop.

The differentiator is **record == replay**: the agent acts through Hover's *grounded* browser tools, so the selector that drove a click is the exact one saved, and crystallization is **deterministic** (no LLM writing code). No confabulated selectors, no runtime dependency on Hover, no lock-in.

## The suite — four surfaces, one artifact

| Surface | Role | What it is |
|---|---|---|
| **MCP** — `@hover-dev/mcp` | **author** | The engine. Add it to your own agent; `/mcp__hover__test_app` explores + crystallizes specs. BYO-CLI — your model, your subscription, no keys of ours. |
| **VS Code** — `hover-dev` | **review** | An optional cockpit: a **Business Map** graph of your app's flows + coverage, a Dashboard (pass / fail / flaky + CI results), one-click run. |
| **CI** | **run** | The crystallized specs run on every PR as plain Playwright — no agent, no tokens. Hover generates the workflow for you. |
| **Cloud** *(optional, planned)* | **watch** | Hosted parallel runs, scheduled monitoring, a flakiness dashboard, on-failure self-heal — *over* the specs you already own. Never authoring lock-in. |

The through-line is **the artifact**: owned, portable Playwright in your repo and your CI. The AI authors it once; nothing AI runs after.

## Quickstart

Add the MCP to your agent (Claude Code shown — any MCP-capable agent works):

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

Then, in your agent:

```
/mcp__hover__test_app           # explore the app and crystallize a suite
/mcp__hover__test_app login     # …or scope it to one flow
```

Specs land in `__vibe_tests__/`. Run them anywhere, with no AI:

```bash
npx playwright test __vibe_tests__
```

Want a visual surface? Install the **[Hover VS Code extension](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)** (`hyperyond.hover-dev`) for the Business Map graph + the Dashboard. It's a review cockpit — it drives no agent.

## Why Hover

- **record == replay** — grounded actuation + deterministic crystallize: the saved selector is the one that drove the run. Playwright codegen / Stagehand / Midscene can't guarantee this.
- **You own the artifact** — plain `@playwright/test` in your repo, runs in your CI with zero AI. No proprietary format, no runtime dependency on Hover, no lock-in.
- **BYO-CLI** — Hover bundles no AI runtime and no keys; it rides the coding agent + subscription you already pay for. We manage *how* to test, never *which* model.
- **Test knowledge that compounds** — Hover keeps a **Business Map** of your flows + the rules it learns in `.hover/`, committed with your code — so the suite stays self-aware and gets smarter as your app grows.

## How it works

```
your agent (Claude Code / Cursor)
   │  MCP tools — grounded actuation
   ▼
@hover-dev/mcp ──▶ CDP ──▶ your debug Chrome ──▶ your app
   │
   └─ crystallize_spec ──▶ __vibe_tests__/<flow>.spec.ts   (plain Playwright, no AI)
```

The agent never freehand-writes the spec: it acts through grounded tools (`role+name → testId → text`), and Hover translates the recorded steps to Playwright deterministically — so what you replay is what you recorded.

## FAQ

**Do I need the VS Code extension?** No. The MCP is the whole authoring loop. The extension is an optional review cockpit (Business Map + Dashboard).

**Does Hover upload my source or DOM?** No. Your agent talks to its own provider; Hover bundles no model, no keys, no telemetry, and has no upload path.

**My UI changed and a spec breaks.** Selectors are semantic, so most churn doesn't break them. When it does, edit the plain Playwright by hand, or re-run `/mcp__hover__test_app <flow>` to re-crystallize. There's no CI-time auto-heal on purpose — CI stays deterministic and free; on-failure self-heal is a planned Cloud feature.

## Roadmap

**Hover Cloud (planned, optional):** parallel runs, scheduled monitoring, a flakiness dashboard, and on-failure self-heal — a hosted layer *over* the specs you already own. Authoring stays local and free; the cloud only ever runs and watches the tests you own, never locking them in. [Join the waitlist](https://gethover.dev/#cloud).

## Built on

[**Playwright**](https://playwright.dev/) (+ [Codegen](https://playwright.dev/docs/codegen)), the [**Model Context Protocol**](https://modelcontextprotocol.io/), and the BYO coding-agent CLIs ([Claude Code](https://claude.com/claude-code) / [Codex](https://github.com/openai/codex) / …). [**Stagehand**](https://github.com/browserbase/stagehand) and [**Midscene**](https://github.com/web-infra-dev/midscene) proved an LLM can drive a real browser; Hover shortens the loop — drive once at authoring, then step out for good.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): Node 22+ / pnpm 10+, Conventional Commits (enforced), `pnpm typecheck && pnpm test` before pushing, keep `main` runnable.

## License

[Apache-2.0](./LICENSE) © Hyperyond
