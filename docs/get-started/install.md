# Install

The fastest path is the zero-config CLI — it reads your `package.json`, picks the right Hover integration, and edits your bundler config in place.

```bash
npx @hover-dev/cli add
```

That single command:

1. Detects your bundler (Vite / Astro / Nuxt / Next / Webpack) from `package.json`.
2. Sniffs your lockfile to pick the package manager (pnpm / yarn / bun / npm).
3. Installs the right Hover package (`vite-plugin-hover`, `@hover-dev/astro`, `@hover-dev/nuxt`, `@hover-dev/next`, or `webpack-plugin-hover`).
4. Uses [magicast](https://github.com/unjs/magicast) to AST-mutate your bundler config so the plugin is registered.
5. Is **idempotent** — running it twice on the same project no-ops the second time.

Force a specific framework with a flag, or preview with `--dry-run`:

```bash
npx @hover-dev/cli add --vite
npx @hover-dev/cli add --next --dry-run
```

## Monorepos (turbo / pnpm-workspace / yarn workspaces)

Run the CLI from the repo root. It enumerates workspaces and:

- **One match** — installs into that workspace automatically.
- **Multiple matches in a TTY** — shows an interactive picker (`↑/↓`, Enter).
- **Multiple matches in CI** — lists candidates and asks you to re-run with `--cwd apps/web`.

The package manager is detected by walking up to find a lockfile, so a single root `pnpm-lock.yaml` is enough — sub-workspaces don't need their own.

```bash
# From the repo root — picker appears if more than one app matches
npx @hover-dev/cli add

# Or target a specific workspace directly
npx @hover-dev/cli add --cwd apps/web
```

See the [CLI reference](/reference/cli) for the full monorepo behaviour.

## Manual install

If you'd rather not run the CLI, here's the per-bundler shape.

### Vite

```bash
pnpm add -D vite-plugin-hover
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import hover from 'vite-plugin-hover';

export default defineConfig({
  plugins: [
    react(),
    hover({ autoLaunchChrome: true }),
  ],
});
```

### Astro

```bash
pnpm add -D @hover-dev/astro
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import hover from '@hover-dev/astro';

export default defineConfig({
  integrations: [hover({ autoLaunchChrome: true })],
});
```

### Nuxt

```bash
pnpm add -D @hover-dev/nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@hover-dev/nuxt'],
  hover: { autoLaunchChrome: true },
});
```

### Next.js (Turbopack)

Next 16+ ships Turbopack as the default bundler. Turbopack does not load webpack plugins, so use `@hover-dev/next` instead of `webpack-plugin-hover`.

```bash
pnpm add -D @hover-dev/next
```

```ts
// next.config.ts
import { withHover } from '@hover-dev/next';

export default withHover({
  // your existing Next config
}, { autoLaunchChrome: true });
```

```ts
// instrumentation.ts
export { register } from '@hover-dev/next/instrumentation';
```

```tsx
// app/layout.tsx
import { HoverScript } from '@hover-dev/next';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <HoverScript />
      </body>
    </html>
  );
}
```

### Webpack 5 (also Rspack / CRA)

```bash
pnpm add -D webpack-plugin-hover
```

```js
// webpack.config.js
const Hover = require('webpack-plugin-hover');

module.exports = {
  plugins: [
    new Hover({ autoLaunchChrome: true }),
  ],
};
```

## What gets installed

| Package | Purpose |
|---|---|
| `@hover-dev/core` | Node service — agent invocation, Playwright CDP preflight, WebSocket bridge. |
| `@hover-dev/widget-bootstrap` | Shared widget assets — every bundler plugin emits a byte-identical widget. |
| `vite-plugin-hover` *(or your bundler's shim)* | Wires the service + widget into your dev server. |

See [Plugin options](/reference/plugin-options) for the full configuration surface.
