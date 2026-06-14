# Hover — AI E2E Testing & Security

**English** · [简体中文](./README.zh-CN.md)

**Local-first, open-source AI testing for the web — as a VS Code extension.** Hover spawns the coding-agent CLI you already run (Claude Code / OpenAI Codex) to drive your real Chrome via Playwright MCP, then crystallizes clean runs into plain `@playwright/test` specs that pass CI with **zero AI**. ✦ optimize pass · 🟠 security (IDOR / authz) · 🔴 pentest (offensive, white-box).

## Install

Get it on the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev)** — or open the Extensions view and search **“Hover — AI E2E Testing & Security”**.

You also need **one coding-agent CLI** on your `PATH`: [Claude Code](https://claude.com/claude-code) (`npm i -g @anthropic-ai/claude-code`) or [OpenAI Codex](https://github.com/openai/codex) (`npm i -g @openai/codex`), signed in with your subscription or your own API key. That's the only thing to configure — Hover ships no model SDK and no keys of its own.

## What you get

- **Chat to a test file** — Describe what you want to verify in plain English; Hover drives your real app and saves the verified run as a plain `@playwright/test` spec. The AI's job ends at "save" — CI is pure Playwright, with zero tokens and no key wired in.
- **Multi-environment accounts, handled** — Define test accounts per environment (local / staging / prod) once, then just mention `@account` in chat — the agent logs in for you. Credentials are parameterized into `process.env` references: never written into the spec, the JSDoc, or the sidecar, and the same names export to your CI secrets in one click.
- **Uses your local AI — nothing to configure** — Runs on the Claude Code / Codex CLI already on your machine, on the subscription you already pay for. No model keys to wire, no SDK, nothing leaves your computer (`@hover-dev/core` binds `127.0.0.1`, has no telemetry, no upload path).
- **Security & pentest in the same chat** — Flip into 🟠 **Security** (IDOR / broken authorization / business-logic, via a local HTTPS MITM that replays captured API calls with mutations) or 🔴 **Pentest** (offensive, white-box: SQLi / XSS / SSTI / SSRF / open-redirect / IDOR) against your **own** app. Confirmed findings become `.security.spec.ts` CI gates or a report that says what it did *and didn't* test. No mitmproxy, no Python, no system CA.
- **Deterministic, portable specs** — Selectors are `getByRole / getByLabel / getByText`, not CSS/XPath. An optional, off-by-default **AI optimize pass** polishes a draft into a candidate you accept via diff (original always kept). Every spec is plain Playwright that checks into git and runs without Hover.
- **Self-healing tests (coming)** — When a spec breaks in CI, **Hover Cloud** will repair the UI drift with AI and surface it on a dashboard. Authoring always stays local and free.

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

| Mode | What it does |
|---|---|
| **Normal** | AI authors / runs functional E2E flows → `.spec.ts` |
| 🟠 **Security** | Business / authz — MITM-replay IDOR / auth-bypass / parameter-tampering → `.security.spec.ts` CI gates |
| 🔴 **Pentest** | Offensive — SQLi / XSS / SSTI / SSRF / IDOR on your **own** dev app → a findings report |

Both are taught by **seeds** — small probe recipes (8 access-control + 9 vulnerability classes). The catalogue ships built-in; add your own JSON under `<root>/.hover/rules/`.

## Other surfaces

Prefer the terminal or your own dev page? `hover run "<prompt>"` authors a spec from the CLI, and the original in-page widget still ships as bundler plugins (Vite / Astro / Nuxt / Next.js / webpack) under [`packages/`](./packages/) — both **frozen** now; the VS Code extension is the going-forward surface.

## Examples

Runnable apps under [`examples/`](./examples/) stress different testing surfaces — login / counter / todos, a ~50-field form, an e-commerce cart/checkout with a cross-tab payment popup, and a canvas app — plus dogfood grounds for Astro, Nuxt, Next.js, webpack, and React Native **Web** (native iOS / Android is out of scope — use Maestro / Detox / Appium).

## FAQ

**My UI changed and my saved spec breaks.** Most UI churn doesn't — selectors are semantic, not CSS/XPath. When semantics shift, **Re-record** (the agent replays the original prompt, ~30 s), edit by hand (it's plain Playwright), or treat it as a real regression. No CI-time auto-heal on purpose — CI stays deterministic and free (self-heal is coming as opt-in Hover Cloud).

**Does Hover upload my source or DOM?** No. The CLI on your `PATH` talks to its own provider; `@hover-dev/core` has no upload path, no telemetry, binds `127.0.0.1`.

## Roadmap

**Planned — Hover Cloud:** a hosted layer over your local specs (parallel runs, scheduled monitoring, a flakiness dashboard, on-failure AI self-heal of UI-drifted specs). Authoring stays local and free; the cloud only ever *runs and monitors* the specs you already own. [Join the waitlist](https://gethover.dev/#cloud).

## Built on the shoulders of

[**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) (the **Local CLI Agent First** architecture), [**Playwright**](https://playwright.dev/) + its [**Codegen**](https://playwright.dev/docs/codegen), [**Stagehand**](https://github.com/browserbase/stagehand) / [**Midscene**](https://github.com/web-infra-dev/midscene) (proved an LLM can drive a real browser), and [**`microsoft/webwright`**](https://github.com/microsoft/webwright) (code-as-action). Hover shortens the loop: drive once at authoring, then step out.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): Node 22+ / pnpm 10+, Conventional Commits (enforced), `pnpm typecheck && pnpm test` before pushing, keep `main` runnable.

## License

[Apache-2.0](./LICENSE) © Hyperyond
