# @hover-dev/widget-bootstrap

Low-level helper that builds the inline-script bundle for [Hover](https://github.com/Hyperyond/Hover)'s floating chat widget.

**This package is for plugin authors.** End users should install one of the official bundler plugins instead:

- [`vite-plugin-hover`](https://www.npmjs.com/package/vite-plugin-hover) — Vite

Future plugins (`webpack-plugin-hover`, `next-plugin-hover`, etc.) will consume this same package to produce a byte-identical widget bundle regardless of the host bundler.

## What this package owns

- The four widget source files (`template.html`, `style.css`, `client.js`, `reducer.js`) that make up the floating chat widget.
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

`getWidgetScript` and `buildWidgetBundle` both accept an optional `transformBody: (body: string) => string` callback. This is the seam for the future v0.3.x "click element → fix prompt" feature: per-host source-attribution injection (React fiber `_debugSource`, Vue `data-v-inspector`, framework-agnostic `data-hover-source`) plugs in here. The bootstrap package itself stays unaware of any framework.

## License

Apache-2.0 — same as the rest of Hover.
