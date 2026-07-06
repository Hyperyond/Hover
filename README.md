# Hover — open-source Vibe Testing suite

**English** · [简体中文](./README.zh-CN.md)

[![npm @hover-dev/mcp](https://img.shields.io/npm/v/%40hover-dev%2Fmcp?label=npm%20%40hover-dev%2Fmcp&color=cb3837&logo=npm)](https://www.npmjs.com/package/@hover-dev/mcp)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/hyperyond.hover-dev?label=VS%20Marketplace&color=1f9cf0&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Playwright](https://img.shields.io/badge/output-%40playwright%2Ftest-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**Point the coding agent you already run at Hover, and get a real Playwright test suite you own.** Hover is an open-source **Vibe Testing** suite: add its MCP server to your own agent (Claude Code, Cursor, …) and the agent explores your app, maps its business flows, and crystallizes each one into a plain `@playwright/test` spec under `__vibe_tests__/`. The saved tests are **yours** — they run in your CI with **zero AI** in the loop.

The differentiator is **record == replay**: the agent acts through Hover's *grounded* browser tools, so the selector that drove a click is the exact one saved, and crystallization is **deterministic** (no LLM writing code). No confabulated selectors, no runtime dependency on Hover, no lock-in.

> **Define the behavior. Ship the code. Keep the regression.** Vibe-coding is fast, but it edits old code as readily as new, so a flow that worked yesterday breaks quietly today. Hover flips the order: you **declare what a feature should do** first, and that spec becomes a fixed contract your agent keeps **fitting the code to** — write the code, run the specs in **CI**, and Hover Cloud **judges** each failure (drift vs bug) and routes the fix back, iterating until green. The AI fits to your spec, not the other way around. See [Guard-first development](#guard-first-development).

## The suite — four surfaces, one artifact

| Surface | Role | What it is |
|---|---|---|
| **MCP** — `@hover-dev/mcp` | **author** | The engine. Add it to your own agent; `/mcp__hover__test_app` explores + crystallizes specs. BYO-CLI — your model, your subscription, no keys of ours. |
| **VS Code** — `hover-dev` | **review** | An optional cockpit: a **Business Map** graph of your app's flows + coverage, a Dashboard (pass / fail / flaky + CI results), one-click run. |
| **CI** | **run** | The crystallized specs run on every PR as plain Playwright — no agent, no tokens. Hover generates the workflow for you. |
| **[Cloud](https://cloud.gethover.dev)** *(live · free early access)* | **watch & close the loop** | Ingests your CI results and gives you dashboards, flakiness, regression alerts, a **drift-vs-bug heal queue**, a **business map + knowledge base**, and the run verdicts that drive guard-first development. Runs **no browsers** — it reads results, never your tests. |

The through-line is **the artifact**: owned, portable Playwright in your repo and your CI. The AI authors it once; nothing AI runs on the green path.

## Quickstart

Add the MCP to your agent (Claude Code shown — any MCP-capable agent works):

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

**Already installed?** Update with `npm i -g @hover-dev/mcp@latest`, then reload your agent so it re-spawns the server — no need to re-run `claude mcp add`. ([Updating →](https://www.gethover.dev/docs/get-started/install/#updating))

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

## Guard-first development

**`/guard` declares what should be true → `/build` drives it to green.**

Testing existing flows is half of it. The other half is **building new ones test-first** — without asking an LLM to freehand-write Playwright for UI that doesn't exist yet.

```
/mcp__hover__guard  add a daily check-in; a 7-day streak shows a badge on the stats page
```

**`guard` declares the intent (the red light):** it asks about the ambiguous edges, records the intent as business rules anchored to a business line, and writes a **pending line + acceptance criteria** onto your Business Map. Declarative — no spec is fabricated.

```
/mcp__hover__build  Daily check-in
```

**`build` drives it to green:** your agent writes the code, walks the flow in your live app to verify each acceptance criterion, then **crystallizes** the spec from that real run (record == replay intact). It runs the full regression, pushes, and reads **Hover Cloud's verdict** on every failure — `bug` → fix the code, `drift` → heal the outdated spec, `unclear` → stop and ask you. It iterates until CI is green; **merging is always yours.**

The loop's outer half (CI verdicts) needs a connected Cloud account — run `Hover: Connect Hover Cloud` in VS Code, or set `HOVER_CLOUD_TOKEN`. Authoring and the inner loop stay fully local.

## Why Hover

- **record == replay** — grounded actuation + deterministic crystallize: the saved selector is the one that drove the run. Playwright codegen / Stagehand / Midscene can't guarantee this.
- **You own the artifact** — plain `@playwright/test` in your repo, runs in your CI with zero AI. No proprietary format, no runtime dependency on Hover, no lock-in.
- **BYO-CLI** — Hover bundles no AI runtime and no keys; it rides the coding agent + subscription you already pay for. We manage *how* to test, never *which* model.
- **Test knowledge that compounds** — Hover keeps a **Business Map** of your flows + the rules it learns in `.hover/`, committed with your code — so the suite stays self-aware and gets smarter as your app grows.
- **AI only on what already ran** — the green CI path is 100% AI-free. Cloud's judge works a *failed* run (drift vs bug, scored against your rules), never a green build, never your local authoring.

## How it works

```
your agent (Claude Code / Cursor)
   │  MCP tools — grounded actuation
   ▼
@hover-dev/mcp ──▶ CDP ──▶ your debug Chrome ──▶ your app
   │
   └─ crystallize_spec ──▶ __vibe_tests__/<flow>.spec.ts   (plain Playwright, no AI)
                                    │
                                    ▼
                         your CI ──▶ Hover Cloud (reads results)
                                        │  drift · bug · unclear + judge
                                        └─▶ back to your editor to fix, human-reviewed
```

The agent never freehand-writes the spec: it acts through grounded tools (`role+name → testId → text`), and Hover translates the recorded steps to Playwright deterministically — so what you replay is what you recorded.

## FAQ

**Do I need the VS Code extension?** No. The MCP is the whole authoring loop. The extension is an optional review cockpit (Business Map + Dashboard).

**Do I need Hover Cloud?** No — authoring, crystallization, and running in your CI are entirely local and free. Cloud adds the *watch & close-the-loop* layer (dashboards, heal queue, verdicts, guard-first's outer loop). It's free during early access and runs no browsers.

**Does Hover upload my source or DOM?** No. Your agent talks to its own provider; Hover bundles no model, no keys, no telemetry. Cloud only ingests the CI results *you* send it (the Playwright report) — it never runs your tests or reaches into your machine.

**My UI changed and a spec breaks.** Selectors are semantic, so most churn doesn't break them. When it does: edit the plain Playwright by hand, run `/mcp__hover__heal <flow>` to re-ground it locally, or — if Cloud is connected — CI's failure lands in the **heal queue**, triaged drift-vs-bug and routed to your editor. The fix is always local and human-reviewed; the green CI path stays deterministic and AI-free.

## Hover Cloud

[**cloud.gethover.dev**](https://cloud.gethover.dev) — a hosted data + heal-orchestration layer *over* the specs you already own and the CI you already run. Sign in with GitHub, connect a repo, and Hover writes the CI workflow and starts watching every run:

- **Dashboards & flakiness** — pass rate, run history, a flakiness score that ranks your shakiest specs.
- **Heal queue** — every failure triaged **drift** (heal the test) vs **bug** (fix the app) vs **unclear**, with an advisory LLM judge scored against your business rules; routed to your editor to fix locally.
- **Business Map & Knowledge timeline** — a coverage graph of your flows and the rules Hover learned, read straight from your repo, with git-backed history.
- **Merge confidence & PR checks** — a deterministic verdict on whether a PR's failures look introduced by it, plus a `hover/e2e` status and coverage summary.
- **Regression alerts, environments, teams** — email / Slack alerts, staging / production targets, invites + roles.

Free during early access. It runs no browsers — the strongest anti-lock-in position there is.

## Built on

[**Playwright**](https://playwright.dev/) (+ [Codegen](https://playwright.dev/docs/codegen)), the [**Model Context Protocol**](https://modelcontextprotocol.io/), and the BYO coding-agent CLIs ([Claude Code](https://claude.com/claude-code) / [Codex](https://github.com/openai/codex) / …). [**Stagehand**](https://github.com/browserbase/stagehand) and [**Midscene**](https://github.com/web-infra-dev/midscene) proved an LLM can drive a real browser; Hover shortens the loop — drive once at authoring, then step out for good.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): Node 22+ / pnpm 10+, Conventional Commits (enforced), `pnpm typecheck && pnpm test` before pushing, keep `main` runnable.

## License

[Apache-2.0](./LICENSE) © Hyperyond
