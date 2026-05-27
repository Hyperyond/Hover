# @hover-dev/next

Next.js (App Router) integration for [Hover](https://github.com/Hyperyond/Hover) — the floating chat widget that lets an AI agent drive your real Chrome via CDP + Playwright MCP.

## Why a dedicated integration?

[`webpack-plugin-hover`](https://www.npmjs.com/package/webpack-plugin-hover) covers Next under `next dev --webpack`, but Next 16+ ships **Turbopack as the default bundler** and Turbopack does not load webpack plugins. This package is the Turbopack-native path: pure config wrapper + Next's official `instrumentation.ts` hook + a Server Component for the widget script tag. Works under both Turbopack and webpack.

No-op outside `next dev` / `next start`. Skipped during `next build` (we boot from `instrumentation.ts`, which Next deliberately does not run at build time).

## Install

```bash
pnpm add -D @hover-dev/next
```

## Usage

Three small pieces:

```ts
// next.config.{mjs,ts}
import { withHover } from '@hover-dev/next';
export default withHover({ /* your existing next config */ }, {
  autoLaunchChrome: true,
});
```

```ts
// instrumentation.ts (at the project root, or under src/)
import { register as registerHover } from '@hover-dev/next/instrumentation';
export async function register() {
  await registerHover();
}
```

```tsx
// app/layout.tsx — render <HoverScript /> after {children}
import { HoverScript } from '@hover-dev/next';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      {children}
      <HoverScript />
    </body></html>
  );
}
```

`npx @hover-dev/cli add` wires up the first two for you (config wrapper + instrumentation) and prints the `<HoverScript />` step as a manual one-liner — we deliberately don't AST-mutate user JSX.

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `port` | `number` | `51789` | Auto-bumps up to 9 times if busy |
| `enabled` | `boolean` | `NODE_ENV === 'development'` | Set to `false` to disable |
| `chromeDebugPort` | `number` | `9222` | CDP port of the debug Chrome |
| `autoLaunchChrome` | `boolean` | `false` | Pre-spawn a debug Chrome on `next dev` |
| `devUrl` | `string` | `http://localhost:3000/` | URL the auto-launched Chrome opens to |
| `agentId` | `string` | `'claude'` | One of `@hover-dev/core`'s registered agents |
| `model` | `string` | `'sonnet'` | Default model |
| `maxBudgetUsd` | `number` | none | Hard $ ceiling per command |

## Plugins (e.g. `@hover-dev/security`)

Unlike the Vite / Astro / Nuxt / Webpack integrations — which accept Hover plugins as additional arguments to `hover()` / `new HoverPlugin()` — Next plugins are passed to `register()` in `instrumentation.ts` as **module-specifier strings**:

```ts
// instrumentation.ts
import { register as registerHover } from '@hover-dev/next/instrumentation';

export async function register() {
  await registerHover({}, [
    '@hover-dev/security',
    // Object form for plugins that take options:
    // { module: '@hover-dev/security', options: { cdpPort: 9444 } },
  ]);
}
```

**Why strings instead of `import securityMode from '@hover-dev/security'`?** Next compiles `instrumentation.ts` for both the Node and Edge runtimes. A top-level `import` of a plugin package would be statically traced into the Edge bundle — and plugin packages like `@hover-dev/security` carry Node-only deps (mockttp, playwright-core, …) that break Edge compilation.

The specifier is resolved at runtime, behind an opaque dynamic-import wall that Turbopack's tracer can't see, so the plugin and its transitive deps stay strictly Node-runtime-only.

Install the plugin package alongside this one:

```bash
pnpm add -D @hover-dev/security
```

## How it composes

```
@hover-dev/next  (this package)
   ├─ withHover()       · serialises HoverOptions onto process.env
   ├─ register()        · boots the service inside Next's instrumentation hook
   ├─ <HoverScript />   · Server Component renders the widget script tag
   ├─ @hover-dev/core             · startService(), launchDebugChrome()
   └─ @hover-dev/widget-bootstrap · buildWidgetBundle()
```

The widget bytes are byte-identical to what `vite-plugin-hover` / `@hover-dev/astro` / `@hover-dev/nuxt` / `webpack-plugin-hover` ship — all five consume `@hover-dev/widget-bootstrap`'s mid-level API.

## Edge-runtime safety

`@hover-dev/next` only runs in the Node.js runtime. The `register()` entry exits immediately if `process.env.NEXT_RUNTIME !== 'nodejs'`, and Node-only imports (`@hover-dev/core/service`, `playwright-core`, `ws`) live behind a string-built dynamic import so the Edge runtime bundler never sees them. You can use Next's Edge runtime for your own pages alongside this integration without warnings.

## License

Apache-2.0 — same as the rest of Hover.
