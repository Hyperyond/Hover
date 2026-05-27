# Quick start

Add Hover to a project you already have running. One command, one config edit, then `pnpm dev` like usual.

## Prerequisites

- A Vite / Astro / Nuxt / Next.js / Webpack project — any framework Hover supports.
- Node 22+ on PATH.
- Either `claude` (Claude Code) or `codex` (OpenAI Codex) on PATH — Hover spawns whichever coding-agent CLI you already have. No new API keys.

::: tip Don't have an agent CLI yet?
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`, then `claude login`. Uses the Claude Pro / Max subscription you might already pay for.
- **OpenAI Codex** — `npm install -g @openai/codex`, then `codex login`.

Either works. You can switch from the widget header any time.
:::

## Install

Run inside your project root:

```bash
npx @hover-dev/cli add
```

That command:

1. Reads your `package.json` and detects your bundler.
2. Installs the right Hover integration package.
3. AST-edits your bundler config (`vite.config.ts`, `astro.config.mjs`, `nuxt.config.ts`, `next.config.ts`, or `webpack.config.js`) to register the plugin.
4. Is idempotent — running it twice is a no-op.

::: tip Monorepo (turbo / pnpm-workspace / yarn workspaces)
Run from the repo root. If one workspace declares a bundler the CLI installs there automatically; if several do, an interactive picker (↑/↓, Enter) appears. Or target an app directly: `npx @hover-dev/cli add --cwd apps/web`. See [Monorepos](./install#monorepos-turbo-pnpm-workspace-yarn-workspaces) for the full breakdown.
:::

::: tip Next.js
The CLI handles `next.config.*` and `instrumentation.ts` for you, then prints one final line to paste into `app/layout.tsx` — `<HoverScript />` inside `<body>`. Works on Next 15 + 16, with Turbopack or webpack, any of `.ts` / `.mjs` / `.js` configs.
:::

Prefer to do it by hand? See the [manual install per bundler](./install#option-b-manual-install).

## Start your dev server

Use whatever command you already use:

```bash
pnpm dev          # or `npm run dev`, `yarn dev`, `bun dev`
```

Hover starts a local service on `127.0.0.1:51789` and injects a floating widget (Shadow DOM, marked `data-hover="true"`) into your dev page. The widget connects on its own.

::: tip First-run debug Chrome
On first ✨ click, the widget prompts you to launch an **isolated debug Chrome** on port 9222 (separate from your everyday browser — a clean profile under `<tmpdir>/hover-chrome`). Click the prompt and a debug Chrome opens, navigated to your dev URL. Subsequent runs reuse it.

You can opt into auto-launch on `pnpm dev` by passing `autoLaunchChrome: true` to the plugin. See [Plugin options](/reference/plugin-options).
:::

## Send your first prompt

Click the ✨ launcher in the corner of the page. Type, or hold the 🎙 button and speak:

```
log in, then add a todo named "verify hover"
```

Press <kbd>↵</kbd> or **Send**. The agent drives the debug Chrome, narrates each tool call, and renders a Result + Findings card when done.

## Save the session

Click **Save as Spec** on the Result card. The verified flow becomes a `__vibe_tests__/<slug>.spec.ts` file — plain `@playwright/test` code that runs in your CI with no Hover dependency.

That's the loop: speak / type → agent verifies → crystallize once → CI replays forever.

## What's next

- [Your first session](./first-session) — A guided walkthrough of every widget control on a real flow.
- [Pick an agent](./agents) — Differences between Claude and Codex, and how to add others.
- [Security testing](/features/security) — Probe your dev app for authz / authn / parameter-tampering issues, then crystallize findings as regression specs.
- [Voice mode](/features/voice-mode) — Push-to-talk speech in 中文 / English, browser-native, no API keys.
