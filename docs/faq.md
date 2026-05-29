# FAQ

## My UI changed and my saved spec breaks. What now?

This is the central question for any AI-authored e2e test. Hover's answer is three-layered.

### 1. Most UI churn doesn't break the spec

Hover generates `getByRole / getByLabel / getByTestId` semantic selectors — never CSS classes or XPath. "Submit button" stays "Submit button" after a layout pass; the spec keeps running. We make this choice in [`packages/core/src/specs/writeSpec.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/core/src/specs/writeSpec.ts) and reinforce it in the system prompt the agent reads on every run.

### 2. When the *semantics* shift — button renamed, label changed, role swapped — the spec turns red

You have three options, listed from cheapest to most explicit:

- **Re-record it.** Open the widget's **📜 Saved sessions** overlay → **Specs** tab → click **⟳ Re-record**. Or from a terminal: `pnpm hover re-record <spec>`. The agent reads the spec's JSDoc `Original prompt:` header ("log in then add a todo") and replays it against the *current* UI, then overwrites the `.spec.ts` with new selectors. About 30 seconds, about $0.10 per spec. Review the `git diff` before committing. See the [Re-record a spec](/features/re-record) page for the full walkthrough.
- **Edit by hand.** The spec is plain `@playwright/test` — `getByRole('button', { name: 'Submit' })` → `'Sign in'`. Faster if you know exactly what changed.
- **Treat it as a regression.** If the test fails because the *flow* broke (not just the selector), that's the test catching a real bug — fix the app, not the spec.

### 3. Why we don't auto-heal at CI time

The Stagehand / Midscene model: tests "self-heal" by calling an LLM mid-run, retrying with new selectors until they pass. It works, but it builds a permanent runtime dependency on a hosted AI provider — every CI run pays an LLM call, every PR, every nightly. Across a year of CI cycles that's measurable money and a fragility surface (provider rate limits, regional outages, model deprecations).

Hover takes the opposite position: **AI is for authoring tests, not running them.** The saved `.spec.ts` is plain Playwright — `pnpm test:e2e` is deterministic and free. When the UI changes enough that selectors break, you trigger Re-record once, deliberately, and the new spec is again deterministic and free. The token cost concentrates at the moment you actually need a model, not amortised across thousands of regression runs.

## Why no `re-record --all` or `--failed`?

Both rejected on purpose for v0.11.

**`--all`** would re-record every spec under `__vibe_tests__/`. Sounds convenient — but it burns LLM tokens on specs that were perfectly fine. With 20 specs in the project and 3 actually broken, `--all` pays for 17 unnecessary agent runs. It also produces git-diff noise across the 17 that don't need changing: same intent, different agent-chosen selector style, still a diff you have to review.

**`--failed`** is the right shape of the answer — only re-record specs that Playwright reports as failing — and is on the v0.12 roadmap. It needs a first-class run-Playwright-and-collect-failures step the CLI doesn't yet ship.

For v0.11, the pattern is: CI tells you which specs are red, you re-record them one at a time and review each diff. Slightly slower, much cleaner history.

## Security spec auth setup — how do I run a security spec in CI when the auth cookies live in my debug Chrome?

The agent recorded the IDOR / authz probes with the cookies from your logged-in debug-Chrome session. Playwright in CI is a fresh process — it doesn't have those cookies. Plug them in via Playwright's `storageState` mechanic:

1. Add an auth-setup step to your `playwright.config.ts`:

   ```ts
   projects: [
     { name: 'setup', testMatch: /global\.setup\.ts/ },
     {
       name: 'security',
       testMatch: /\.security\.spec\.ts/,
       dependencies: ['setup'],
       use: { storageState: '.auth/user.json' },
     },
   ],
   ```

2. In `global.setup.ts`, log in once (via API or UI) and write the resulting cookies to `.auth/user.json` with `await context.storageState({ path: '.auth/user.json' })`.

3. CI now runs your security spec with the same effective auth as Hover recorded.

Same pattern Playwright uses for UI-level e2e auth — see the [official docs](https://playwright.dev/docs/auth) for the full reference. The Hover spec works as long as the `request` fixture has the storageState; the generated spec doesn't try to authenticate on its own.

## What's the difference between a Skill and a Spec?

Generated from the same Save card on the same Hover session. Used very differently:

| | **Skill** (`.claude/skills/<slug>/SKILL.md`) | **Spec** (`__vibe_tests__/<slug>.spec.ts`) |
|---|---|---|
| **Read by** | Claude / agent | Playwright (CI) |
| **When** | You say *"execute &lt;skill&gt;"* in a future Hover conversation | Every `pnpm test:e2e` / CI run |
| **Failure mode** | Agent self-adapts to UI changes (no selectors written down) | Selector breaks if UI semantics shift → needs re-record or hand edit |
| **Determinism** | Best-effort replay | Hard contract |

**Skills are for repeated *exploration*. Specs are for repeated *verification*.** Many sessions deserve both.

## Will Hover spawn another headless Chromium? My CI is already busy.

No. `@hover-dev/core` launches one isolated debug Chrome under `<tmpdir>/hover-chrome` and connects via CDP. It never spawns a fresh Chromium per command, and it doesn't touch your CI's Playwright browsers — those are configured entirely in `playwright.config.ts` and unrelated to Hover's debug Chrome.

## Does Hover send my source code or DOM to a hosted service?

No. Hover spawns the coding-agent CLI on your local `PATH` (`claude`, `codex`, `cursor-agent`, etc.) and that CLI talks to its own provider (Anthropic, OpenAI, Cursor). `@hover-dev/core` itself has no LLM SDK code, no telemetry, no upload path. The Node service binds to `127.0.0.1` only and refuses connections from any other interface.

## Why doesn't the widget show up in `astro build` / `next build` / `vite build` output?

All bundler integrations are dev-only (`apply: 'serve'` for Vite, `command === 'dev'` for Astro, `nuxt.options.dev` for Nuxt, etc.). Production builds are no-ops by design. The Shadow-DOM widget is also marked `data-hover="true"` so any Playwright run against production HTML can filter it out with one selector.

## Can I run Hover in CI to author new tests automatically?

You can — set `HOVER_AGENT=claude --max-budget-usd 0.50` and write a CI job that POSTs a prompt — but it's an anti-pattern most of the time. Hover is built around the assumption that a human reviews each generated spec before committing it. Automated authoring without review tends to produce specs that pass once and then accumulate selector debt no one notices until they break.

The supported workflow is: a human runs Hover during development, saves verified sessions, commits the resulting deterministic specs. CI just runs Playwright.
