# @hover-dev/cli

One-command setup for [Hover](https://github.com/Hyperyond/Hover) — detects your bundler, installs the right integration package, and wires it into your config file.

## Usage

No installation required. `npx` runs the latest published version on demand:

```bash
npx @hover-dev/cli add
```

That's it. The CLI:

1. **Reads your `package.json`** to figure out your bundler (Vite, Astro, Nuxt, or Webpack).
2. **Reads your lockfile** to pick the right package manager (pnpm, yarn, bun, or npm).
3. **Installs** the matching Hover package as a dev dependency.
4. **Updates** your config file (`vite.config.ts` / `astro.config.mjs` / `nuxt.config.ts` / `webpack.config.js`) to load the plugin.

Then run your dev server and click the floating ✨ in the bottom-right corner.

## Force a specific bundler

If detection picks the wrong one (e.g. your project has multiple bundlers, or you're starting from a fresh repo), use a flag:

```bash
npx @hover-dev/cli add --vite        # vite-plugin-hover
npx @hover-dev/cli add --astro       # @hover-dev/astro
npx @hover-dev/cli add --nuxt        # @hover-dev/nuxt
npx @hover-dev/cli add --webpack     # webpack-plugin-hover
```

## Preview without modifying anything

```bash
npx @hover-dev/cli add --dry-run
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
pnpm hover add
```

## License

Apache-2.0 — same as the rest of Hover.
