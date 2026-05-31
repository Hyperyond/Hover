# CLI

`@hover-dev/cli` is the zero-install setup CLI. Exposed as the `hover` bin once installed.

```bash
npx @hover-dev/cli add
```

Reads your `package.json` to pick the right Hover integration (Vite / Astro / Nuxt / Next / Webpack), sniffs your lockfile to pick the package manager (pnpm / yarn / bun / npm), spawns the install command, then uses [magicast](https://github.com/unjs/magicast) to AST-mutate your bundler config.

## Flags

```
--vite              Force the Vite integration (vite-plugin-hover)
--astro             Force the Astro integration (@hover-dev/astro)
--nuxt              Force the Nuxt integration (@hover-dev/nuxt)
--next              Force the Next integration (@hover-dev/next)
--webpack           Force the Webpack integration (webpack-plugin-hover)
--cwd <path>        Target a specific workspace (monorepos). Absolute or
                    relative to where you invoked the CLI. -C is the short form.
--dry-run           Preview the install + config edits without applying them
```

## Monorepo support

Recognised shapes: pnpm-workspace (`pnpm-workspace.yaml`), npm/yarn workspaces (`workspaces` field), turbo (`turbo.json`).

Run the CLI from the repo root:

```bash
npx @hover-dev/cli add
```

The CLI enumerates the declared workspaces and detects bundlers in each.

- **Exactly one match** — dispatches automatically. The CLI installs the Hover package into that workspace and edits its config file (not the root).
- **Multiple matches in a TTY** — an interactive picker appears. `↑/↓` (or `j/k`) to move, `Enter` to confirm, `Esc` / `q` / `Ctrl-C` to cancel.
- **Multiple matches in CI / piped invocation** — the CLI prints the candidates and exits 1; re-run with `--cwd apps/web` (or whichever workspace path).
- **No match** — the CLI tells you it's a monorepo root with no supported bundler in any declared workspace, and points you at `--cwd`.

You can always skip detection and target one app directly:

```bash
npx @hover-dev/cli add --cwd apps/web
```

Run the CLI once per app you want to wire. There is no `--all` mode by design — each install gets independent install / mutate failure modes you can react to.

The package manager is detected by walking up from the target workspace until it finds a lockfile, so a pnpm-managed monorepo with a single root `pnpm-lock.yaml` works without surprise — sub-workspaces don't need their own lockfile.

## Idempotency

Running `npx @hover-dev/cli add` twice on the same project no-ops the second time. Safe to put in a setup script.

## Detection priority

Frameworks are matched in this order so a project whose dep tree legitimately contains a lower-priority framework still routes to the right shim:

1. `astro`
2. `nuxt`
3. `next` — checked before webpack so Next projects (Turbopack default since Next 16) route to `@hover-dev/next`, not `webpack-plugin-hover`.
4. `webpack` — matches on `webpack-cli` (the user-facing dep), not a transitive `webpack` (every Vite project has webpack somewhere).
5. `vite` — catch-all for Vite-based projects that aren't Astro / Nuxt / Svelte.

An explicit `--<framework>` flag overrides detection entirely.

## Next.js: two-file mutator + one manual step

For Next, the CLI does two file edits:

- Wraps the user's `next.config.{mjs,js,ts}` export in `withHover(...)`.
- Creates (or merges into) `instrumentation.ts` at the project root or under `src/`, calling Hover's `register()` from inside the user's own `register()` hook.

It deliberately does **not** auto-edit `app/layout.tsx`. The `<HoverScript />` insertion is printed as a one-liner for you to paste — AST-mutating user JSX invites whitespace drift and Server Component shape surprises.
