# webpack-plugin-hover

Webpack 5 plugin for [Hover](https://github.com/Hyperyond/Hover) — the floating chat widget that lets an AI agent drive your real Chrome via CDP + Playwright MCP.

## Compatibility

Hover ships separate packages per bundler because each one has its own HTML pipeline. This package targets every host that runs the **webpack 5 compiler API**:

| Stack | Status |
|---|---|
| **vanilla `webpack-dev-server`** | ✅ canonical target |
| **Rspack / Rsbuild** | ✅ API-compatible, `HtmlRspackPlugin` works out of the box |
| **Create React App (legacy)** | ✅ via [`craco`](https://craco.js.org) or `react-app-rewired` (CRA is in maintenance mode but still uses webpack 5 + HtmlWebpackPlugin) |
| **Vue CLI (legacy)** | ✅ via `vue.config.js`'s `configureWebpack` (Vue CLI is in maintenance mode) |
| **Next.js with `--webpack`** | ✅ but requires the `--webpack` flag (Next.js 16 ships Turbopack as the default; webpack plugins do not load under Turbopack) |
| **Next.js default (Turbopack)** | ❌ not supported by webpack plugins. Use [`@hover-dev/next`](https://www.npmjs.com/package/@hover-dev/next) for the Turbopack-native path |

For Vite-based projects use [`vite-plugin-hover`](https://www.npmjs.com/package/vite-plugin-hover); for Astro use [`@hover-dev/astro`](https://www.npmjs.com/package/@hover-dev/astro); for Nuxt use [`@hover-dev/nuxt`](https://www.npmjs.com/package/@hover-dev/nuxt).

## Install

```bash
pnpm add -D webpack-plugin-hover
```

`html-webpack-plugin` is an **optional peer dep** — if your setup already has it (CRA, Vue CLI, Rspack, vanilla wds with HtmlWebpackPlugin all do), it's used. Otherwise the plugin falls back to a `processAssets` HTML splice.

## Usage

```js
// webpack.config.js
import { HoverPlugin } from 'webpack-plugin-hover';

export default {
  mode: 'development',
  // ... your config ...
  plugins: [
    new HtmlWebpackPlugin({ template: './src/index.html' }),
    new HoverPlugin({ autoLaunchChrome: true }),
  ],
  devServer: { port: 8080 },
};
```

Run `webpack serve`, click the floating ✨ in the bottom-right.

### Rspack / Rsbuild

Identical — Rspack's `HtmlRspackPlugin` exposes the same `alterAssetTagGroups` hook used by `HtmlWebpackPlugin`.

```js
// rsbuild.config.ts
import { defineConfig } from '@rsbuild/core';
import { HoverPlugin } from 'webpack-plugin-hover';

export default defineConfig({
  tools: { rspack: { plugins: [new HoverPlugin({ autoLaunchChrome: true })] } },
});
```

### Next.js (with `--webpack`)

```bash
next dev --webpack
```

Plus in `next.config.js`:

```js
module.exports = {
  webpack: (config, { dev }) => {
    if (dev) {
      const { HoverPlugin } = require('webpack-plugin-hover');
      config.plugins.push(new HoverPlugin({ autoLaunchChrome: true }));
    }
    return config;
  },
};
```

Pure Turbopack (the Next 16 default) does **not** load webpack plugins; for that path use [`@hover-dev/next`](https://www.npmjs.com/package/@hover-dev/next) instead.

## Options

Same shape as the other Hover integrations:

| Option | Type | Default | Notes |
|---|---|---|---|
| `port` | `number` | `51789` | Auto-bumps up to 9 times if busy |
| `enabled` | `boolean \| ({ mode, watch }) => boolean` | `mode === 'development' && watch` | `webpack serve` sets `watch=true` |
| `chromeDebugPort` | `number` | `9222` | CDP port of the debug Chrome |
| `autoLaunchChrome` | `boolean` | `false` | Pre-spawn a debug Chrome |
| `devUrl` | `string` | derived from `devServer.port` | Override the URL Chrome opens to |
| `devRoot` | `string` | `compiler.context` | Override the project root for saved specs / `.hover` artifacts |
| `agentId` | `string` | `'claude'` | One of `@hover-dev/core`'s registered agents |
| `model` | `string` | `'sonnet'` | Default model |
| `maxBudgetUsd` | `number` | none | Hard $ ceiling per command |

## Plugins (e.g. `@hover-dev/security`)

Since v0.9, `new HoverPlugin(opts, ...plugins)` accepts Hover plugins as additional positional arguments — same shape as `vite-plugin-hover`:

```js
import { HoverPlugin } from 'webpack-plugin-hover';
import securityMode from '@hover-dev/security';

export default {
  // ... your config ...
  plugins: [
    new HtmlWebpackPlugin({ template: './src/index.html' }),
    new HoverPlugin({ autoLaunchChrome: true }, securityMode()),
  ],
};
```

Older `new HoverPlugin({})` calls without plugins continue to work unchanged.

## How it composes

```
webpack-plugin-hover  (this package)
   ├─ @hover-dev/core              · startService(), launchDebugChrome()
   └─ @hover-dev/widget-bootstrap  · buildWidgetBundle()
```

The widget bytes are byte-identical to what `vite-plugin-hover`, `@hover-dev/astro`, and `@hover-dev/nuxt` ship — all four consume `@hover-dev/widget-bootstrap`'s mid-level API.

## License

Apache-2.0 — same as the rest of Hover.
