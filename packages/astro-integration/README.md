# @hover-dev/astro

Astro integration for [Hover](https://github.com/Hyperyond/Hover) — the floating chat widget that lets an AI agent drive your real Chrome via CDP + Playwright MCP.

## Why a separate integration?

Astro is Vite-based, so you might think dropping [`vite-plugin-hover`](https://www.npmjs.com/package/vite-plugin-hover) into `astro.config.mjs`'s `vite.plugins` would work. It almost does — the WebSocket service boots correctly via Vite's `configureServer` hook — but **Astro's HTML pipeline silently drops the widget `<script>` tag** that the Vite plugin returns from `transformIndexHtml`. `.astro` pages don't go through the standard Vite HTML transform path.

Astro's blessed extension point for "add a script to every page" is `injectScript('page', ...)` on the integration API. This package wires the Hover service + widget bundle into that API.

## Install

```bash
pnpm add -D @hover-dev/astro
```

## Usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { hover } from '@hover-dev/astro';

export default defineConfig({
  integrations: [hover({ autoLaunchChrome: true })],
});
```

That's it. Run `astro dev`, click the floating ✨ in the bottom-right.

## Options

Same shape as `vite-plugin-hover`'s `HoverOptions`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `port` | `number` | `51789` | Auto-bumps up to 9 times if busy |
| `enabled` | `boolean \| ({ command }) => boolean` | `command === 'dev'` | Disable for `astro build` / `preview` / `sync` |
| `chromeDebugPort` | `number` | `9222` | CDP port of the debug Chrome |
| `autoLaunchChrome` | `boolean` | `false` | Pre-spawn a debug Chrome on `astro dev` |
| `agentId` | `string` | `'claude'` | One of `@hover-dev/core`'s registered agents |
| `model` | `string` | `'sonnet'` | Default model |
| `maxBudgetUsd` | `number` | none | Hard $ ceiling per command |

## How it composes

```
@hover-dev/astro  (this package)
   ├─ @hover-dev/core              · startService(), launchDebugChrome()
   └─ @hover-dev/widget-bootstrap  · buildWidgetBundle()
```

The widget bytes are byte-identical to what `vite-plugin-hover` ships — both consume `@hover-dev/widget-bootstrap`'s mid-level API.

## License

Apache-2.0 — same as the rest of Hover.
