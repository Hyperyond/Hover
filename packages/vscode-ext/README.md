# Hover — Vibe-test your app, ship real Playwright specs.

**Describe a flow in plain English; Hover's AI tests your app like a real teammate and hands you a real Playwright spec.** Hands-free, local-first, running on the Claude Code or Codex CLI you already have. The AI's job ends at "save", so CI stays pure Playwright with zero tokens.

- **Chat to a real Playwright spec** — Describe what to verify; Hover drives your real Chrome and crystallizes the run into a plain `@playwright/test` spec with `getByRole` / `getByLabel` selectors. It runs in CI forever, with no AI and no keys.
- **Tests like a real teammate** — When the agent hits something it can't safely decide (which account to use, an ambiguous step, a destructive action), it asks you right in the editor instead of guessing or stalling.
- **Multi-environment accounts, `@`-mentionable** — Define test accounts per environment (local / staging / prod) once, then mention `@account` in chat and the agent logs in for you. Passwords live in VS Code SecretStorage, get parameterized into `process.env` in the spec, and export to your CI secrets in one click.
- **Your model, local ones included** — Runs on the coding-agent CLI already on your machine: Claude Code, OpenAI Codex, Gemini, or Qwen, on your own subscription or key. Point it at a self-hosted endpoint to drive a local model. Nothing leaves your computer.
- **Nothing new to learn** — The chat looks and works like Claude Code or Codex. Install it, open the panel, describe a flow. No setup in your app, no bundler plugin, no config.
- **API testing and pentest modes** — Flip the same chat to 🟠 API testing (drive & verify your API — auth, status codes, access control, IDOR / broken authorization, via a local HTTPS MITM that replays captured calls with mutations) or 🔴 Pentest (offensive, white-box, your **own** app). Findings become regression specs (CI gates) or a report.

## Requirements

- **VS Code 1.85** or higher
- **One coding-agent CLI** on your `PATH` — [Claude Code](https://claude.com/claude-code) (`npm i -g @anthropic-ai/claude-code`) or [OpenAI Codex](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with your subscription or your own API key.

## New to Hover?

Visit [gethover.dev](https://www.gethover.dev/) to get started, or read the [docs](https://www.gethover.dev/docs).

Open source (Apache-2.0) — [github.com/Hyperyond/Hover](https://github.com/Hyperyond/Hover).
