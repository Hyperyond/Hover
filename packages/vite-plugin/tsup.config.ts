import { defineConfig } from 'tsup';

/**
 * Bundle config for `vite-plugin-hover`.
 *
 * Why tsup (not tsc): we depend on a private workspace package
 * (`@hover-dev/transform-source`) that isn't published to npm.
 * tsup with `noExternal` inlines that package's compiled output into
 * our own dist, so consumers `pnpm add vite-plugin-hover` and get a
 * working plugin without ever seeing the internal package.
 *
 * What stays external (auto-detected from `dependencies`):
 *  - `@hover-dev/core` — published separately; carries the agent runtime,
 *    Playwright, ws, etc. Consumers install it via our `dependencies`.
 *  - `@hover-dev/widget-bootstrap` — ships widget asset files
 *    (template.html / style.css / client.js / reducer.js) that its
 *    own `reader.js` resolves via `import.meta.url`. Inlining would
 *    relocate import.meta.url to our dist/ and break the asset lookup.
 *  - `vite` — peerDependency; host project pins the version.
 *
 * What gets inlined via `noExternal`:
 *  - `@hover-dev/transform-source` — private package, never published.
 *    Inlining is mandatory; without it the dist would carry an
 *    unresolvable bare import.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/bin/hover-chrome.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  // Inline transform-source's compiled output. Its npm dependencies
  // (@babel/*, @vue/compiler-sfc, svelte, @astrojs/compiler, magic-string)
  // remain external — they must be in our `dependencies` so consumers
  // resolve them normally. Inlining the dep chain would force esbuild
  // to bundle @vue/compiler-sfc's ~30 optional template-engine requires
  // (atpl, liquor, twig, ...) which it can't resolve.
  noExternal: ['@hover-dev/transform-source'],
  external: [
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    '@vue/compiler-sfc',
    '@astrojs/compiler',
    'svelte',
    'svelte/compiler',
    'magic-string',
  ],
});
