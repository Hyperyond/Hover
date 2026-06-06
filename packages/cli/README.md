# @hover-dev/cli

One-command setup for [Hover](https://github.com/Hyperyond/Hover) — detects your bundler, installs the right integration package, and wires it into your config file. Also ships a `re-record` subcommand for refreshing saved Playwright specs against a drifted UI.

## Usage

No installation required. `npx` runs the latest published version on demand:

```bash
npx @hover-dev/cli setup
```

That's it. The `add` subcommand:

1. **Reads your `package.json`** to figure out your bundler (Vite, Astro, Nuxt, Next.js, or Webpack).
2. **Reads your lockfile** to pick the right package manager (pnpm, yarn, bun, or npm).
3. **Installs** the matching Hover package as a dev dependency.
4. **Updates** your config file (`vite.config.ts` / `astro.config.mjs` / `nuxt.config.ts` / `next.config.{ts,mjs,js}` / `webpack.config.js`) to load the plugin.

Then run your dev server and click the floating ✨ in the bottom-right corner.

## Monorepos (turbo / pnpm-workspace / yarn workspaces)

Run from the repo root. The CLI enumerates the workspaces declared in `pnpm-workspace.yaml` / `package.json` `workspaces` / `turbo.json` and looks for a supported bundler in each:

- **One match** — dispatches into that workspace automatically.
- **Multiple matches in a TTY** — interactive picker (`↑/↓`, Enter). `Esc` to cancel.
- **Multiple matches in CI / piped invocation** — lists candidates and asks for `--cwd apps/web`.

```bash
npx @hover-dev/cli setup --cwd apps/web   # target a specific workspace
```

Sub-workspaces don't need their own lockfile — the CLI walks up to find one, so a pnpm-managed monorepo with a single root `pnpm-lock.yaml` works without surprise.

## Force a specific bundler

If detection picks the wrong one (e.g. your project has multiple bundlers, or you're starting from a fresh repo), use a flag:

```bash
npx @hover-dev/cli setup --vite        # vite-plugin-hover
npx @hover-dev/cli setup --astro       # @hover-dev/astro
npx @hover-dev/cli setup --nuxt        # @hover-dev/nuxt
npx @hover-dev/cli setup --next        # @hover-dev/next
npx @hover-dev/cli setup --webpack     # webpack-plugin-hover
```

## Preview without modifying anything

```bash
npx @hover-dev/cli setup --dry-run
```

Prints what would be installed + which config file would be modified, then exits without changing anything.

## What if my config file is unusual?

The CLI uses [magicast](https://github.com/unjs/magicast) to safely mutate `defineConfig({ ... })` and bare-object configs. If your config has an unusual shape (re-exported config, conditional logic, etc.), the CLI will:

1. Still install the right Hover package.
2. Skip the config mutation and print the exact lines you need to paste in.

This is also what happens if you have no config file at all — many projects rely on bundler defaults until they need to customise.

## Use as a project dep (optional)

`npx` is the default and recommended way. If you want to lock the CLI version per-project (e.g. to make a setup command for new teammates), install it as a dev dep:

```bash
pnpm add -D @hover-dev/cli
pnpm hover setup
```

## Run from the terminal (`hover run`)

```bash
hover run "test the login flow" --url http://localhost:5173 --save login
```

Drive Hover from the terminal — no widget, no DOM injection. `hover run` auto-launches the isolated debug Chrome if one isn't up, drives it over CDP via `@hover-dev/core`'s session engine, streams the run, and (with `--save <slug>`) crystallizes it to `__vibe_tests__/<slug>.spec.ts`. Then polish with `hover optimize <slug>`.

CLI mode needs only the engine — no `setup`, no bundler config (that's for injecting the widget):

```bash
npm i -D @hover-dev/core @hover-dev/cli
```

Flags: `--url <devUrl>`, `--save <slug>`, `--agent <id>`, `--model <m>`, `--cwd <path>`. It's **not headless** — a real, visible Chrome you log into once. Record mode / Fix prompt / voice stay widget-only. Full reference: [CLI docs](https://gethover.dev/docs/reference/cli#hover-run-cli-mode).

## Re-record a spec

```bash
npx @hover-dev/cli re-record <spec>
```

Regenerate a Hover-saved Playwright spec against the current UI. The CLI reads the spec's JSDoc `Original prompt:` header, boots a one-shot `@hover-dev/core` service, replays the prompt against your current dev server, and overwrites the file with new selectors.

Flags:

- `--dry-run` — run the agent end-to-end but don't write the file (preview cost / behaviour).
- `--cwd <path>` — target a workspace inside a monorepo.
- `--port <n>` — service port (default 51789; auto-bumps if busy).

See the [Re-record a spec](https://gethover.dev/docs/features/re-record) feature page for the full walkthrough.

## License

Apache-2.0 — same as the rest of Hover.
