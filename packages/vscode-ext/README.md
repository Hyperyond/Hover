# Hover — the review cockpit for your Vibe Testing suite

**A place to see, run, and watch the Playwright suite your agent authored.** Hover is an open-source **Vibe Testing** suite: you add its [MCP server](https://www.npmjs.com/package/@hover-dev/mcp) to the coding agent you already run (Claude Code, Cursor, …), and the agent explores your app and crystallizes each flow into a plain `@playwright/test` spec you own. **This extension is the optional cockpit on top of that** — it drives no agent and ships no engine; it's where you review the suite, its coverage, and its run health.

## What it gives you

- **Business Map** — a graph of your app's business flows read from `.hover/hover-map.md`: areas → business lines → the spec each one produced, coloured by coverage. Lives in its own Activity Bar view and a full editor panel.
- **Dashboard** — the spec × run health matrix (pass / fail / flaky), wired to your GitHub Actions runs: Hover can generate the CI workflow and pull each run's Playwright results back into the view. One click to install the MCP, one to open [gethover.dev](https://www.gethover.dev/).
- **Environments** — define Local + remote targets (the roster commits to `.hover/environments.json`); account passwords stay in VS Code SecretStorage. Pick the active environment for running specs.
- **Run specs (F3)** — a CodeLens on every `*.spec.ts` runs it through *your own* Playwright in a terminal. No agent, no tokens — just `@playwright/test`.

## How authoring works

Authoring happens in your coding agent via the MCP, not in this extension:

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

Already installed? Update the MCP with `npm i -g @hover-dev/mcp@latest`, then reload your agent (no need to re-run `claude mcp add`). This extension updates itself from the Marketplace.

Then, in your agent: `/mcp__hover__test_app` explores your app and crystallizes specs into `__vibe_tests__/`. Come back here to review the Business Map, watch the Dashboard, and run the suite. The differentiator is **record == replay** — the agent acts through grounded tools, so the selector that drove a click is the exact one saved, and the saved tests run in your CI with **zero AI**.

## Requirements

- **VS Code 1.85** or higher.
- A Hover-tested project — i.e. one where you've run `@hover-dev/mcp` from your own coding agent. The extension reads the `.hover/` wiki + `__vibe_tests__/` specs it produces.

## New to Hover?

Visit [gethover.dev](https://www.gethover.dev/) to get started, or read the [docs](https://www.gethover.dev/docs).

Open source (Apache-2.0) — [github.com/Hyperyond/Hover](https://github.com/Hyperyond/Hover).
