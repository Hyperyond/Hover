# @hover-dev/widget-bootstrap

Low-level helper that builds the inline-script bundle for [Hover](https://github.com/Hyperyond/Hover)'s floating chat widget.

**This package is for plugin authors.** End users should install one of the official bundler plugins instead:

- [`vite-plugin-hover`](https://www.npmjs.com/package/vite-plugin-hover) — Vite
- [`@hover-dev/astro`](https://www.npmjs.com/package/@hover-dev/astro) — Astro
- [`@hover-dev/nuxt`](https://www.npmjs.com/package/@hover-dev/nuxt) — Nuxt
- [`@hover-dev/next`](https://www.npmjs.com/package/@hover-dev/next) — Next.js 16+ (Turbopack-native)
- [`webpack-plugin-hover`](https://www.npmjs.com/package/webpack-plugin-hover) — webpack 5 (wds / Rspack / Rsbuild / CRA-via-craco / Vue CLI / `next dev --webpack`)

All five consume this package to produce a byte-identical widget bundle regardless of the host bundler.

## What this package owns

- The six widget source files (`template.html`, `style.css`, `client.js`, `reducer.js`, `voice.js`, `host.js`) that make up the floating chat widget. The widget plugin host (`host.js`) exposes `window.__HOVER_WIDGET__` so plugin packages (`@hover-dev/security`, future third-party plugins) can register modes, save entries, and panels without patching core widget code (v0.9+).
- An mtime-keyed cache that re-reads + re-transforms the files only when they change on disk (preserving the "edit a widget file → reload page → see change" dev loop without paying for the read on every page request).
- The exact preamble (`window.__HOVER_PORT__`, `window.__HOVER_CSS__`, `window.__HOVER_HTML__`) the widget client expects on boot.
- The two regex-replace passes that strip ESM `export` keywords from `reducer.js` so it can concatenate cleanly into the widget IIFE.

## Public API

Three layers, high → low. Pick the one that matches what your host bundler can do.

```ts
import {
  getWidgetScript,
  buildWidgetBundle,
  readWidgetAssets,
} from '@hover-dev/widget-bootstrap';

// High: returns a Vite HtmlTagDescriptor. One-liner inside transformIndexHtml.
const tag = getWidgetScript({ port: () => servicePort });

// Mid: preamble + body strings. Assemble your own <script> tag — useful for
// webpack's HtmlWebpackPlugin, Next.js _document, or a raw HTTP server.
const { preamble, body } = buildWidgetBundle({ port: 51789 });

// Low: raw, mtime-cached asset bytes. Webpack plugins may prefer this so the
// widget assets become real Compilation assets instead of inline script.
const { html, css, js, reducer } = readWidgetAssets();
```

### `port` accepts a thunk

Pass either a `number` or a `() => number`. Vite's `transformIndexHtml` needs the latter because the actual bound port isn't known until `configureServer` finishes (auto-bump from 51789 if the port is busy). Other bundlers usually have a stable port and can pass a number directly.

### `transformBody` hook

`getWidgetScript` and `buildWidgetBundle` both accept an optional `transformBody: (body: string) => string` callback. This is the seam the "click element → fix prompt" feature (v0.4+) and the multi-framework source-attribution feature (v0.8+) use to inject the `data-hover-source` stamp on host elements before the widget script ships. The bootstrap package itself stays unaware of any framework.

## License

Apache-2.0 — same as the rest of Hover.
