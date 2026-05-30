# Monorepo layout

Hover is a single pnpm workspace. `packages/*` ship to npm; `examples/*` are smoke targets.

## Published packages

| Package | What it does |
|---|---|
| `@hover-dev/core` | The Node service: agent CLI invocation, Playwright CDP preflight, WebSocket bridge between the widget and the agent. Owns the plugin API ([Reference → Plugin API](/reference/plugin-api)). |
| `@hover-dev/widget-bootstrap` | The widget itself — HTML template, CSS, vanilla JS. Builds a script bundle every bundler-plugin re-uses byte-identically. |
| `vite-plugin-hover` | The Vite dev-server shim. `apply: 'serve'` so it's a no-op in production builds. |
| `@hover-dev/astro` | Astro integration. Astro's HTML pipeline bypasses Vite's `transformIndexHtml`, so this package wraps the core service + widget bundle behind Astro's `injectScript('page', …)`. |
| `@hover-dev/nuxt` | Nuxt module. Nuxt renders HTML through Nitro, not Vite, so we push the widget into `nuxt.options.app.head.script`. |
| `@hover-dev/next` | Next.js (App Router, Turbopack) integration. Three pieces: `withHover` config wrapper, `register()` from `@hover-dev/next/instrumentation`, and the `<HoverScript />` Server Component. |
| `webpack-plugin-hover` | Webpack 5 plugin — vanilla `webpack-dev-server`, Rspack / Rsbuild, legacy CRA / Vue CLI. Hooks `HtmlWebpackPlugin.alterAssetTagGroups`. Does NOT cover Next 16+ (Turbopack default). |
| `@hover-dev/cli` | `npx @hover-dev/cli add` — reads the user's `package.json`, picks the right shim, AST-mutates their bundler config via [magicast](https://github.com/unjs/magicast). |
| `@hover-dev/security` | The first optional plugin. MITM HTTPS proxy + flow inspector + MCP server for the agent. See [Features → Security testing](/features/security). |

## Examples

Each example runs on its own port and uses one of the bundler shims, so they double as smoke targets for every integration:

| Example | Port | Stresses |
|---|---|---|
| `basic-app` | 5173 | Login + counter + todos — minimal happy-path test |
| `e-commerce` | 5174 | Cart state, product grid, checkout, cross-tab popup payment flow |
| `stock-registration` | 5175 | Realistic ~50-field brokerage account form, conditional reveals |
| `canvas-paint` | 5176 | Canvas drawing + DOM toolbar (canvas pixels are opaque to Playwright snapshots) |
| `payment-provider` | 5177 | Deliberately unintegrated third-party payment page; popup target for e-commerce |
| `astro-app` | 5178 | Astro 5 dogfood |
| `nuxt-app` | 5179 | Nuxt 4 dogfood |
| `webpack-app` | 5180 | Vanilla webpack 5 + `webpack-dev-server` |
| `rn-web-app` | 5181 | React Native Web — RN components rendering to DOM |
| `next-app` | 5182 | Next 16 App Router (Turbopack default) |
| `turbo-monorepo` | — | turbo + pnpm-workspace with two Next.js 15 apps (`apps/web`, `apps/game`); reproduces the shape real users have when running `npx @hover-dev/cli add` on a turbo project; not part of `pnpm dev:example:*` |

Concurrent examples are supported. The Hover service auto-bumps from `127.0.0.1:51789` up through `:51798`; each widget reads `window.__HOVER_PORT__` and connects only to its own service.

## Next.js entry-point tax

Most packages set `main` / `exports` directly to `src/*.ts`, so consumers' transpilers see TypeScript source with zero build step. The dev loop is *"edit `.ts` → HMR."*

**Two exceptions: `@hover-dev/core` and `@hover-dev/widget-bootstrap`** point `main` / `exports` at `dist/*.js`. Reason: `@hover-dev/next` consumes them via `await import(…)` from inside Next's `instrumentation.ts`, and Next 16's Turbopack does not rewrite NodeNext-style `.js` import specifiers back to on-disk `.ts` files inside transitively-traced source packages (open issue [vercel/next.js#82945](https://github.com/vercel/next.js/issues/82945)).

Practical implications:

- A root `postinstall` hook runs `pnpm --filter @hover-dev/core --filter @hover-dev/widget-bootstrap build` after every `pnpm install`. Fresh clones get usable `dist/` artefacts before anyone touches an example.
- `pnpm dev:example:next-app` spawns `concurrently` with `tsc --watch` for both packages + `next dev` itself. Edits to `packages/core/src/service.ts` re-emit `packages/core/dist/service.js` in ~500 ms; Next picks up the changed `dist` file and HMRs.
- Other examples (Vite / Astro / Nuxt / Webpack / RN Web) tolerate `src`-entry shape but consume those two packages via `dist` too. The `postinstall` guarantees `dist` exists; the watchers aren't running for those examples, so a cross-package edit during example dev needs either a one-shot `pnpm --filter @hover-dev/core build` or a separate `pnpm --filter @hover-dev/core dev` terminal.

This is temporary. When vercel/next.js#82945 ships, both packages switch back to `src`-entry shape and the watcher dance goes away. Tracking comment lives in `packages/next-integration/src/withHover.ts`.
