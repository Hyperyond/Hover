# @hyperyond/vite-plugin

Vite plugin that injects the Hover chat widget into your dev server. The developer types a natural-language instruction; an agent on the user's PATH (`claude`, today) drives their real Chrome via CDP + Playwright MCP; verified sessions crystallize into `__vibe_tests__/<slug>.spec.ts` files for plain Playwright CI runs.

Part of the [Hover](https://github.com/Hyperyond/Hover) monorepo. See the top-level README for the full pitch and architecture.

## Install

```bash
pnpm add -D @hyperyond/vite-plugin
```

No `.npmrc`, no auth tokens — `@hyperyond/*` is public on npmjs.com.

## Use

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { hover } from '@hyperyond/vite-plugin';

export default defineConfig({
  plugins: [hover()],
});
```

Run your dev server:

```bash
pnpm dev
```

Open your dev URL in any Chrome — the ✨ launcher in the bottom-right colour-codes what (if anything) it needs:

- **Blue** — page is already in a debug Chrome. Click and chat.
- **Amber** — no debug Chrome detected. Click → widget launches one (isolated profile under `<tmpdir>/hover-chrome`, navigated to your dev URL) → prompts you to switch over.
- **Gray** — a debug Chrome is running but in a different Chrome process. Click → service brings the right tab to the front. The widget in this window stays disabled — use the one in the debug Chrome.

Pass `autoLaunchChrome: true` to skip the colour dance and pre-warm Chrome at `vite dev` instead (matches the smoke flow). Pass `false` (the default) to let the widget drive it on demand. Either way, `pnpm exec hover-chrome` (or `npx hover-chrome`) is available as an escape hatch.

## Options

```ts
hover({
  port?: 51789,                // local WebSocket port; auto-bumps if taken
  enabled?: true,              // false to disable (default: only in dev mode)
  chromeDebugPort?: 9222,
  autoLaunchChrome?: false,    // true to launch Chrome at vite dev (widget drives it by default)
  agentId?: 'claude',          // matches @hyperyond/core's agent registry
  model?: 'sonnet',            // 'opus' costs ~5x; sonnet is fine for browser driving
  maxBudgetUsd?: undefined,    // hard $ ceiling per command; default no cap (use Stop in the widget)
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
