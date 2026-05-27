# Introduction

Hover is a Vite/Astro/Nuxt/Next/Webpack plugin that injects a floating chat widget into your dev server page. You type — or [speak](/features/voice-mode) — a natural-language instruction like *"test the login flow"*. An agent drives your *actual* dev Chrome over CDP, narrates each step, and crystallizes the verified session into a standard Playwright spec under `__vibe_tests__/`.

The differentiator vs. Stagehand / Midscene / Playwright codegen is the **AI exploration → deterministic script** workflow: AI authors the test, but the saved artifact is plain `@playwright/test` code that runs in CI without an agent in the loop.

## What's inside this section

- [Quick start](./quick-start) — Install in your existing project. 60 seconds.
- [Install](./install) — Pick your bundler. `npx @hover-dev/cli add` auto-detects.
- [Your first session](./first-session) — A guided walkthrough of every widget control.
- [Pick an agent](./agents) — Claude (hard sandbox) or Codex (soft). One-line registry to add more.

::: tip Going further
Hover has optional plugins for specialised workflows. The first is **[Security testing](/features/security)** — installs alongside the base plugin and adds a mode that captures HTTPS traffic + lets the agent probe for authz / authn / parameter-tampering issues, crystallising findings into Playwright regression specs.

Building Hover itself? See **[Development](/development/)** for the monorepo workflow.
:::

## At a glance

- **No API key required.** Hover spawns the coding-agent CLI you already have on PATH (`claude`, `codex`, …) and reuses the subscription you already pay for.
- **No production overhead.** Plugins are no-op in production builds (`apply: 'serve'`).
- **Local-first.** The Node service binds to `127.0.0.1` only. Cookies and localStorage never transit it.
- **One artefact, three formats.** Save the same session as a Playwright spec, a Hover Skill (replayable later by name), or a Jira / Xray-compatible test case CSV.
