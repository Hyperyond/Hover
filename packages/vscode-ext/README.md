# Hover — the review cockpit for your Vibe Testing suite

**A place to see, run, and watch the Playwright suite your agent authored.** Hover is an open-source **Vibe Testing** suite: you add its [MCP server](https://www.npmjs.com/package/@hover-dev/mcp) to the coding agent you already run (Claude Code, Cursor, …), and the agent explores your app and crystallizes each flow into a plain `@playwright/test` spec you own. **This extension is the optional cockpit on top of that** — it drives no agent and ships no engine; it's where you review the suite, its coverage, and its run health.

One **Hover** view in the Activity Bar, gated on **Sign in to Hover Cloud** — a miniature Hover Cloud in your editor. Signed in, it's a tabbed panel:

## What it gives you

- **Overview** — the spec × run health matrix (pass / fail / flaky) with a per-spec flaky flag, and a **Local ↔ Remote** toggle: *Local* reads this checkout's `.hover/runs`; *Remote* reads the CI runs Hover Cloud ingested for this repo. Run all specs or any single spec through *your own* Playwright.
- **Heal** — this repo's open heal queue: specs that drifted in CI. Click one to copy its `/mcp__hover__heal <slug>` command; paste it into your coding agent, review the diff, and CI closes the item when the spec is green again.
- **Environments** — Local + remote targets (the roster commits to `.hover/environments.json`). Each test account is a **label + email + password** — passwords stay in VS Code SecretStorage, never in a spec. Set the active target, and export an environment's `HOVER_<LABEL>_USER/PASS` vars to a local `.env` or your clipboard for CI secrets.
- **Map** — a coverage summary read from `.hover/hover-map.md`; open the full business-flow graph in an editor panel.
- **Run specs (F3)** — a CodeLens on every `*.spec.ts` runs it through your own Playwright in a terminal. No agent, no tokens — just `@playwright/test`.

## How authoring works

Authoring happens in your coding agent via the MCP, not in this extension:

```bash
npm i -g @hover-dev/mcp
claude mcp add hover -- hover-mcp
```

Already installed? Update the MCP with `npm i -g @hover-dev/mcp@latest`, then reload your agent (no need to re-run `claude mcp add`). This extension updates itself from the Marketplace.

Then, in your agent: `/mcp__hover__test_app` explores your app and crystallizes specs into `__vibe_tests__/`. Come back here to review the Business Map, watch the Dashboard, and run the suite. The differentiator is **record == replay** — the agent acts through grounded tools, so the selector that drove a click is the exact one saved, and the saved tests run in your CI with **zero AI**.

The point of the suite is regression safety for AI-written code: you define a flow's behavior once, as a spec, and it guards that behavior on every future change — however much the AI rewrites the code underneath, the spec holds it to what you defined.

## Requirements

- **VS Code 1.85** or higher.
- A Hover-tested project — i.e. one where you've run `@hover-dev/mcp` from your own coding agent. The extension reads the `.hover/` wiki + `__vibe_tests__/` specs it produces.

## New to Hover?

Visit [gethover.dev](https://www.gethover.dev/) to get started, or read the [docs](https://www.gethover.dev/docs).

Open source (Apache-2.0) — [github.com/Hyperyond/Hover](https://github.com/Hyperyond/Hover).
