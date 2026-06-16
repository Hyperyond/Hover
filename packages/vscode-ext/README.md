# Hover — Vibe-test your app, ship real Playwright specs.

**Vibe-test your app, ship real Playwright specs.** Describe a flow in plain English, watch AI drive your real browser, and save it as a Playwright spec that runs in CI forever — no agent, no model, no keys.

Hover spawns the coding-agent CLI you already run (Claude Code / OpenAI Codex), drives your real Chrome via Playwright, and crystallizes the verified run into plain `@playwright/test` code. The AI's job ends at "save" — CI stays pure Playwright, with zero tokens.

- **Chat to a test file** — Describe what you want to verify; Hover drives your real app and saves the verified run as a plain `@playwright/test` spec. No recording by hand, no brittle selectors.
- **Multi-environment accounts, handled** — Define test accounts per environment (local / staging / prod) once, then just mention `@account` in chat — the agent logs in for you. Credentials are parameterized into `process.env` references: never written into the spec, and the same names export to your CI secrets in one click.
- **Uses your local AI — nothing to configure** — Runs on the Claude Code / Codex CLI already on your machine, on the subscription you already pay for. No model keys to wire, no SDK, nothing leaves your computer.
- **Security & pentest in the same chat (experimental)** — Flip into 🟠 Security (IDOR / broken authorization / business-logic) or 🔴 Pentest (offensive, white-box) against your **own** app — confirmed findings become `.security.spec.ts` CI gates or a report. _Experimental: both modes are still stabilizing — try them, but expect rough edges._
- **Self-healing tests (coming)** — When a spec breaks in CI, Hover Cloud will repair the UI drift with AI and surface it on a dashboard. Authoring always stays local and free.

## Requirements

- **VS Code 1.85** or higher
- **One coding-agent CLI** on your `PATH` — [Claude Code](https://claude.com/claude-code) (`npm i -g @anthropic-ai/claude-code`) or [OpenAI Codex](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with your subscription or your own API key.

## New to Hover?

Visit [gethover.dev](https://www.gethover.dev/) to get started, or read the [docs](https://www.gethover.dev/docs).

Open source (Apache-2.0) — [github.com/Hyperyond/Hover](https://github.com/Hyperyond/Hover).
