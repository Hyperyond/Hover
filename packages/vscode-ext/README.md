# Hover — Vibe-test your app, ship real Playwright specs.

**Describe a flow in plain English; Hover's AI tests your app like a real teammate and hands you a real Playwright spec.** Hands-free, local-first, running on the Claude Code or Codex CLI you already have. The AI's job ends at "save", so CI stays pure Playwright with zero tokens.

- **Chat to a real Playwright spec** — Describe what to verify; Hover drives your real Chrome and crystallizes the run into a plain `@playwright/test` spec with `getByRole` / `getByLabel` selectors. It runs in CI forever, with no AI and no keys.
- **Tests like a real teammate** — When the agent hits something it can't safely decide (which account to use, an ambiguous step, a destructive action), it asks you right in the editor instead of guessing or stalling.
- **Multi-environment accounts, `@`-mentionable** — Define test accounts per environment (local / staging / prod) once, then mention `@account` in chat and the agent logs in for you. Passwords live in VS Code SecretStorage, get parameterized into `process.env` in the spec, and export to your CI secrets in one click.
- **Your model — Local CLI or BYOK** — Two ways to provide a model, switchable in Settings. *Local CLI*: drive runs with a coding-agent CLI on your PATH (Claude Code, Codex, Gemini, Qwen) on the subscription you already pay for. *BYOK*: bring your own API key — pick a protocol (Anthropic / OpenAI / Azure OpenAI / Gemini) or an OpenAI-compatible gateway, and Hover injects the key + base URL + model into the matching CLI. Either can point at a self-hosted endpoint for a local model. Keys live in VS Code SecretStorage; nothing leaves your computer.
- **Nothing new to learn** — The chat looks and works like Claude Code or Codex. Install it, open the panel, describe a flow. No setup in your app, no bundler plugin, no config.
- **QA Testing mode — explore, don't just script** — Switch from Flow (author one spec) to 🟢 QA Testing: the agent autonomously explores your app to find defects, paces itself by an intensity budget (Quick / Standard / Deep), writes a findings report with a coverage map, and offers each clean flow it completes as a one-click ✨ Crystallize spec. Two capability toggles ride on top — **API testing** (auth / status / access control / IDOR / broken authorization, via a local HTTPS MITM that replays captured calls with mutations → `.api-test.spec.ts` CI gates) and **Penetration testing** (offensive, white-box, your **own** app — destructive, runs as a separate pass, off by default). It remembers business rules it confirms so it doesn't re-ask.

## Requirements

- **VS Code 1.85** or higher
- **One coding-agent CLI** on your `PATH` — [Claude Code](https://claude.com/claude-code) (`npm i -g @anthropic-ai/claude-code`) or [OpenAI Codex](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with your subscription or your own API key.

## New to Hover?

Visit [gethover.dev](https://www.gethover.dev/) to get started, or read the [docs](https://www.gethover.dev/docs).

Open source (Apache-2.0) — [github.com/Hyperyond/Hover](https://github.com/Hyperyond/Hover).
