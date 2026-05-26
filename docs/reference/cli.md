# CLI

`@hover-dev/cli` is the zero-install setup CLI. Exposed as the `hover` bin once installed.

```bash
npx @hover-dev/cli add
```

Reads your `package.json` to pick the right Hover integration (Vite / Astro / Nuxt / Next / Webpack), sniffs your lockfile to pick the package manager (pnpm / yarn / bun / npm), spawns the install command, then uses [magicast](https://github.com/unjs/magicast) to AST-mutate your bundler config.

## Flags

```
--vite            Force the Vite integration (vite-plugin-hover)
--astro           Force the Astro integration (@hover-dev/astro)
--nuxt            Force the Nuxt integration (@hover-dev/nuxt)
--next            Force the Next integration (@hover-dev/next)
--webpack         Force the Webpack integration (webpack-plugin-hover)
--dry-run         Preview the install + config edits without applying them
```

## Idempotency

Running `npx @hover-dev/cli add` twice on the same project no-ops the second time. Safe to put in a setup script.

::: info This page is a placeholder
Full content coming soon — including the detection priority (`next` above `webpack` so Next projects route to `@hover-dev/next` rather than Turbopack-incompatible webpack plugin), and Next's two-file mutator behaviour (`next.config.*` + `instrumentation.ts`).
:::
