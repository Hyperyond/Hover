# Quick start

You need two terminals on first run. Once Chrome and Vite are up they stay running across many smoke loops.

## Clone and install

```bash
git clone https://github.com/Hyperyond/Hover.git
cd Hover
pnpm install
pnpm --filter basic-app exec playwright install chromium   # for `pnpm test:e2e` only
```

## Terminal 1 — dev server + debug Chrome

```bash
pnpm dev:example:basic-app
```

This boots the basic-app example at <http://localhost:5173>. Because the example passes `autoLaunchChrome: true`, this also spawns an isolated debug Chrome on port `9222` (profile dir under `<tmpdir>/hover-chrome`) navigated to the dev URL.

::: tip
Hover deliberately does *not* attach to your everyday Chrome — your normal browsing session stays separate. You'll log in once inside the debug Chrome and the profile dir reuses session state across runs.
:::

## Terminal 2 — invoke the agent

```bash
pnpm smoke
```

End-to-end: detect agents → CDP preflight → invoke `claude` → stream events.

Custom target + prompt:

```bash
pnpm smoke http://localhost:5173/ "log in, then add a todo named 'verify hover'"
```

Environment overrides:

```bash
HOVER_AGENT=claude HOVER_MODEL=sonnet HOVER_CDP=http://localhost:9222 pnpm smoke
```

## What you'll see

1. The widget renders in the bottom-right of the dev page (Shadow DOM, marked `data-hover="true"`).
2. Step events stream into the panel as the agent drives the debug Chrome.
3. At the end, a Result card holds the verification summary; a Findings card lists any bugs / issues the agent flagged.
4. **Save as Spec** turns the session into `__vibe_tests__/<slug>.spec.ts`.

Next: [your first session](./first-session) walks through the basic-app flow step by step.
