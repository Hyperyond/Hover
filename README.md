# Hover

**English** · [简体中文](./README.zh-CN.md)

**Local-first, open-source AI testing for the web.** Hover spawns the coding-agent CLI you already run (Claude Code / OpenAI Codex) to drive your real Chrome via Playwright MCP, then crystallizes clean runs into plain `@playwright/test` specs that pass CI with **zero AI** — no agent, no model, no key. ✦ optimize pass · 🟠 security (IDOR / authz) · 🔴 pentest (offensive, white-box).

[▶ Watch the 2-minute demo](https://www.youtube.com/watch?v=lQV5dmVWaIA)

Open a chat, describe a flow in plain English, watch AI drive your real app — then click **Save as spec** for a standard Playwright file that runs in CI forever with `npx playwright test`.

Hover drives your app once and saves the verified run as a plain Playwright spec. Want it sharper? An optional **AI pass** polishes that spec and shows you the changes as a diff — you accept or reject, and the original is always kept.

**Bring your own CLI — subscription *or* API key.** Hover spawns the coding-agent CLI already on your `PATH` (`claude` / `codex` / …). Ride the subscription you already pay for, or drop your own model API key in (it's passed to the CLI's environment, stored locally, never uploaded). Either way the LLM cost is a one-off at authoring time — never a recurring tax on green builds, since the saved `.spec.ts` runs forever with no agent in the loop.

## Why Hover

Several good tools exist here; Hover is what falls out when you optimise for **artifact portability**.

| Tool | What it does | The trade-off |
|---|---|---|
| **Playwright Codegen** | Records your clicks → `.spec.ts`. No AI | Can't think — replays literally |
| **Stagehand / Midscene** | AI-augmented tests; caches skip the LLM on steady-state runs. Needs an OpenAI / Anthropic key | Tests run **inside the vendor SDK** + cache file — not portable to a plain Playwright runner |
| **Hover** | AI drives the browser **once** to explore, saves a deterministic spec — with an optional AI pass that polishes it into a diff-reviewed candidate — *and* a Jira-importable case. **Spawns the CLI on your `PATH`** — subscription or your own API key | Crystallised spec is brittle to UI change — when it breaks, re-run the agent (no self-heal at CI time) |

Hover isn't trying to be the better *test-time* AI runtime. It makes the saved artifact plain `@playwright/test` code that runs with zero AI deps: the agent's job ends at "save", and CI is pure Playwright — **zero tokens, no key wired into CI**.

### Crystallise two ways

A single **Save as ▾** on the done card crystallises one verified session two ways — every file checks into git, readable by teammates who never install Hover.

| | `.spec.ts` | `.case.csv` |
|---|---|---|
| **Lands in** | `__vibe_tests__/` | `__vibe_tests__/` |
| **Read by** | Node + Playwright (CI) | Xray · Zephyr · Jira |
| **Audience** | CI, devs | QA · PM |
| **Determinism** | Hard contract | Manual review |

## What you get

- **Your subscription or your API key** — spawns whichever coding-agent CLI is on your `PATH`, on the subscription you logged in with or a model API key you provide (injected into the CLI's env, never uploaded). `@hover-dev/core` ships zero LLM SDK code — there's no model client to send a key to in the first place.
- **Multiple agents, per-agent sandbox** — `claude` (hard sandbox, recommended), `codex`, `cursor-agent`, `aider`, `gemini-cli`, `qwen-code`. Hard-sandbox agents can reach only Playwright MCP, with a `--max-budget-usd` ceiling; soft-sandbox agents carry a ⚠ badge.
- **Structured spec output** — Page Objects + fixtures lifted from repeated flows, `test.step(...)` blocks, a `.hover/sidecars/<slug>.json` sidecar per spec, and `Promise.all` popup / new-tab pairing. An optional, off-by-default **AI optimisation pass** polishes a deterministic draft into a candidate you accept via diff (original always kept; buggy behaviour flagged inline), learning from a **seed library** (`.hover/rules/`). `.hover/conventions.md` steers house style; exploration scope matches how specific your prompt is.
- **Resilience + bug discovery** — visibility-guarded selectors fail loudly, not on a 30 s timeout; **Re-record** replays a spec's original prompt to rewrite selectors; the agent's `## Findings` land in a severity-coded card.
- **Security & pentest — two modes, one tool** — flip into 🟠 [`@hover-dev/security`](./packages/security/) (business / authz: a local HTTPS MITM lets the agent replay captured API calls with mutations to probe IDOR / auth-bypass / parameter-tampering, and confirmed findings crystallize into `.security.spec.ts` CI gates) or 🔴 [`@hover-dev/pentest`](./packages/pentest/) (offensive: SQLi / XSS / SSTI / SSRF / open-redirect / IDOR on your **own** dev app, destructive + confirmed in-band, → a findings report that says what it did *and didn't* test). Zero external deps — no mitmproxy, no Python, no system CA; authorized own-app testing only.
- **Credential-aware** — reference a saved test account in the chat by `@label`; the agent logs in with it, and the crystallized spec parameterizes the credentials into `process.env.HOVER_<LABEL>_*` references — the secret never lands in the spec, the JSDoc, or the sidecar. The same env-var names export to CI secrets in one click.
- **Record mode, voice mode, element → source** — drive by hand and get the same spec; push-to-talk prompts (中文 / English); click any element → a source-attributed fix prompt.

## Surfaces

Hover runs as a **VS Code extension** (`hover-dev`) — the chat, the spec / session / environment views, and the engine all live in the editor; nothing else to install. *(Going-forward distribution; landing on the Marketplace — until then, sideload the built `.vsix`.)*

The original **in-page widget + bundler integrations** (Vite / Astro / Nuxt / Next.js / webpack, via `npx @hover-dev/cli setup`) remain installable but are **frozen** — see each package under [`packages/`](./packages/).

## How it works

```
┌────────────────┐   chat (WebSocket)   ┌──────────────────┐
│  Hover UI      │ ───────────────────▶ │  @hover-dev/core │
│  (VS Code or   │ ◀─────────────────── │  Node engine     │ ◀── plugins
│   in-page)     │   step events        │  (127.0.0.1)     │     (mode, MCPs)
└────────────────┘                      └────────┬─────────┘
                                                 │ spawn (sandboxed)
                                                 ▼
                                  claude / codex ── MCP ──▶ Playwright ── CDP ──▶
                                  isolated debug Chrome (port 9222, tmp profile)
```

Hover spawns the coding-agent CLI on your `PATH`, sandboxed to Playwright MCP, driving an isolated debug Chrome over CDP — never your main profile, never a hosted service (`@hover-dev/core` binds `127.0.0.1` only, has no LLM SDK and no telemetry). The plugin slot lets packages like [`@hover-dev/security`](./packages/security/) extend the tool surface.

## Modes

| Mode | What it does |
|---|---|
| **Normal** | AI authors / runs functional E2E flows → `.spec.ts` |
| 🟠 **Security** | Business / authz — MITM-replay IDOR / auth-bypass / parameter-tampering → `.security.spec.ts` CI gates ([`@hover-dev/security`](./packages/security/)) |
| 🔴 **Pentest** | Offensive — SQLi / XSS / SSTI / SSRF / IDOR on your **own** dev app → a findings report ([`@hover-dev/pentest`](./packages/pentest/)) |

Both security modes are taught by **seeds** — small probe recipes (8 access-control + 9 vulnerability classes: IDOR / BOLA / BFLA / mass-assignment / auth-bypass; SQLi / XSS / SSTI / SSRF / open-redirect / path-traversal / GraphQL introspection / CORS / JWT-tamper). The full catalogue ships built-in; drop your own JSON in `<root>/.hover/rules/` to add one, or list a built-in's name under `disabled` in `.hover/seeds.json` to suppress it. Security mode pulls the `authz` set; pentest mode pulls everything.

## Run a spec in CI

Crystallized specs are plain `@playwright/test` — they run anywhere with no AI:

```bash
npx playwright test __vibe_tests__
```

Point them at any environment by setting `BASE_URL` (and any `HOVER_<LABEL>_*` account secrets); the same spec runs against local, staging, or a PR preview. The VS Code extension can generate a GitHub Actions workflow that runs them on every PR.

## Examples

Runnable apps under [`examples/`](./examples/) stress different **testing surfaces** — [`basic-app`](./examples/basic-app) (login / counter / todos), [`stock-registration`](./examples/stock-registration) (~50-field form), [`e-commerce`](./examples/e-commerce) (cart / checkout / cross-tab payment popup), [`canvas-paint`](./examples/canvas-paint) (DOM controls amid canvas) — plus dedicated bundler dogfood grounds for Astro, Nuxt, Next.js, webpack, and React Native Web.

**React Native:** only the **Web** target (it compiles to DOM). Native iOS / Android is out of scope — use Maestro / Detox / Appium.

## FAQ

**My UI changed and my saved spec breaks.** Most UI churn doesn't — selectors are `getByRole / getByLabel / getByText`, not CSS/XPath. When semantics shift, the spec turns red: **Re-record** (the agent replays the original prompt, ~30 s), edit by hand (it's plain Playwright), or treat it as a real regression. No CI-time auto-heal on purpose — CI stays deterministic and free.

**Does Hover upload my source or DOM?** No. The CLI on your `PATH` talks to its own provider; `@hover-dev/core` has no upload path, no telemetry, binds `127.0.0.1`.

## Roadmap

**Planned:** **Hover Cloud** — a hosted layer over your local specs (parallel runs, scheduled monitoring, a flakiness dashboard, and on-failure AI self-heal of UI-drifted specs). Authoring stays local and free; the cloud only ever *runs and monitors* the specs you already own. [Join the waitlist](https://gethover.dev/#cloud).

## Built on the shoulders of

[**`nexu-io/open-design`**](https://github.com/nexu-io/open-design) (the **Local CLI Agent First** architecture), [**Playwright**](https://playwright.dev/) + its [**Codegen**](https://playwright.dev/docs/codegen) (the runtime Hover authors *for*, and deterministic-spec-as-artifact), [**Stagehand**](https://github.com/browserbase/stagehand) / [**Midscene**](https://github.com/web-infra-dev/midscene) (proved an LLM can drive a real browser), and [**`microsoft/webwright`**](https://github.com/microsoft/webwright) (code-as-action). Hover shortens the loop: drive once at authoring, then step out.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md): Node 22+ / pnpm 10+, Conventional Commits (enforced), `pnpm typecheck && pnpm test` before pushing, keep `main` runnable.

## License

[Apache-2.0](./LICENSE) © Hyperyond
