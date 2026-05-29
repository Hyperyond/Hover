# @hover-dev/nuxt

Nuxt module for [Hover](https://github.com/Hyperyond/Hover) — the floating chat widget that lets an AI agent drive your real Chrome via CDP + Playwright MCP.

## Why a module?

Nuxt is Vite-based, so you might think dropping [`vite-plugin-hover`](https://www.npmjs.com/package/vite-plugin-hover) into `nuxt.config.ts`'s `vite.plugins` would work. It almost does — the WebSocket service boots correctly via Vite's `configureServer` hook — but **Nuxt renders HTML through Nitro, not Vite.** Vite's `transformIndexHtml` hook is a no-op for Nuxt's SSR/SSG responses. ([nuxt/nuxt#19853](https://github.com/nuxt/nuxt/issues/19853) — the maintainers explicitly chose this design.)

Nuxt's blessed mechanism for "ship a script tag on every page" is `nuxt.options.app.head.script`, which Nitro renders into the SSR'd HTML. This module pushes the Hover widget bundle there.

## Install

```bash
pnpm add -D @hover-dev/nuxt
```

## Usage

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@hover-dev/nuxt'],
  hover: {
    autoLaunchChrome: true,
  },
});
```

That's it. Run `nuxt dev`, click the floating ✨ in the bottom-right.

## Options

Same shape as `vite-plugin-hover` / `@hover-dev/astro`:

| Option | Type | Default | Notes |
|---|---|---|---|
| `port` | `number` | `51789` | Auto-bumps up to 9 times if busy |
| `enabled` | `boolean` | `nuxt.options.dev` | Set to `false` to disable (e.g. for `nuxt build`) |
| `chromeDebugPort` | `number` | `9222` | CDP port of the debug Chrome |
| `autoLaunchChrome` | `boolean` | `false` | Pre-spawn a debug Chrome on `nuxt dev` |
| `agentId` | `string` | `'claude'` | One of `@hover-dev/core`'s registered agents |
| `model` | `string` | `'sonnet'` | Default model |
| `maxBudgetUsd` | `number` | none | Hard $ ceiling per command |

## Plugins (e.g. `@hover-dev/security`)

Since v0.9, the Nuxt module accepts Hover plugins via a `plugins?:` field on its options. (Nuxt's `defineNuxtModule` setup contract can't take varargs the way `vite-plugin-hover` / `@hover-dev/astro` do, so the shape is slightly different — but the wiring is the same.)

```ts
// nuxt.config.ts
import securityMode from '@hover-dev/security';

export default defineNuxtConfig({
  modules: ['@hover-dev/nuxt'],
  hover: {
    autoLaunchChrome: true,
    plugins: [securityMode()],
  },
});
```

Older configs without `plugins` continue to work unchanged.

## How it composes

```
@hover-dev/nuxt  (this package)
   ├─ @nuxt/kit                    · defineNuxtModule
   ├─ @hover-dev/core              · startService(), launchDebugChrome()
   └─ @hover-dev/widget-bootstrap  · buildWidgetBundle()
```

The widget bytes are byte-identical to what `vite-plugin-hover` and `@hover-dev/astro` ship — all three consume `@hover-dev/widget-bootstrap`'s mid-level API.

## License

Apache-2.0 — same as the rest of Hover.
