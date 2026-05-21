# @hyperyond/vite-plugin

Vite plugin that injects the Hover chat widget into your dev server. The developer types a natural-language instruction; an agent on the user's PATH (`claude`, today) drives their real Chrome via CDP + Playwright MCP; verified sessions crystallize into `__vibe_tests__/<slug>.spec.ts` files for plain Playwright CI runs.

Part of the [Hover](https://github.com/Hyperyond/Hover) monorepo. See the top-level README for the full pitch and architecture.

## Install

The packages are published to GitHub Packages, not npm.org. Add `.npmrc`:

```ini
@hyperyond:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` is a PAT with `read:packages` scope. Then:

```bash
pnpm add -D @hyperyond/vite-plugin
```

## Use

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { hover } from '@hyperyond/vite-plugin';

export default defineConfig({
  plugins: [hover()],
});
```

Start Chrome in debug mode so Hover can connect:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/hover-chrome
```

Open your dev server in that Chrome. The ✨ floating button appears in the bottom-right; click it, type a prompt.

## Options

```ts
hover({
  port?: 51789,                // local WebSocket port; auto-bumps if taken
  enabled?: true,              // false to disable (default: only in dev mode)
  chromeDebugPort?: 9222,
  agentId?: 'claude',          // matches @hyperyond/core's agent registry
  model?: 'sonnet',            // 'opus' costs ~5x; sonnet is fine for browser driving
  maxBudgetUsd?: 0.5,          // per-invocation ceiling
});
```

## What it does

- `apply: 'serve'` — no-op in production builds.
- `transformIndexHtml` (order: `'post'`) injects a single `<script type="module">` with the widget source. The widget self-isolates via Shadow DOM, marked `data-hover="true"` so Playwright runs filter it out.
- `configureServer` boots a long-running `@hyperyond/core` WebSocket service on `127.0.0.1` and tears it down in `closeBundle`.
- Port auto-bump (51789 → 51798) so multiple example apps can run concurrently, each with its own service.

## Sandbox

The agent the plugin spawns is locked down to one capability: drive the browser. Allowed tools = `mcp__playwright` + `Skill` (so saved skills can be invoked). Everything else — `Bash`, `Edit`, `Write`, `Read`, `WebFetch`, `Task`, `EnterWorktree`, `CronCreate`, … — is explicitly denied. `--max-budget-usd 0.5` is a hard ceiling per run.

## License

[Apache-2.0](https://github.com/Hyperyond/Hover/blob/main/LICENSE) © Hyperyond
