import { defineConfig } from 'tsup';

/**
 * Bundle config for `@hover-dev/next`.
 *
 * Why bundle (and not the per-package `tsc` build used by every other
 * Hover package): Next 16 loads `next.config.mjs` via native Node
 * `import()`, which means the entire workspace dependency chain
 * (`@hover-dev/next` → `@hover-dev/widget-bootstrap` → `@hover-dev/core`)
 * has to be resolvable as compiled ESM at install time. The other
 * packages get away with `main: src/index.ts` because their consumers
 * (Vite plugins, Nuxt modules, etc.) sit behind a TS-aware transpiler.
 * Next does not. Bundling here inlines the workspace deps so the
 * published package is self-contained and Node can `import()` it
 * without depending on the other packages also being built.
 *
 * `react` and `next` stay external — they're peerDependencies and the
 * host project is the source of truth for their version.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/instrumentation.ts', 'src/register-node.ts'],
  format: ['esm'],
  dts: true,
  // We deliberately do NOT inline either workspace package:
  //
  // - `@hover-dev/widget-bootstrap` ships actual widget asset files
  //   (`dist/widget/{template.html,style.css,client.js,reducer.js}`)
  //   that its `reader.js` resolves at runtime via `import.meta.url`.
  //   Inlining the JS into our bundle would also relocate that
  //   `import.meta.url` base, but tsup can't bundle the sibling asset
  //   files alongside — they'd be missing on the consumer side. The
  //   only safe shape is "keep widget-bootstrap external" so its own
  //   `dist/widget/...` sits next to its own `dist/reader.js`.
  //
  // - `@hover-dev/core` transitively imports `playwright-core`, which
  //   `require()`s `chromium-bidi` via a CJS path that Next's Edge
  //   bundler can't statically resolve. Even though our `register()`
  //   is gated to NEXT_RUNTIME === 'nodejs', Next compiles the Edge
  //   bundle of `instrumentation.js` and chokes on a static import
  //   chain at compile time. Keeping core external + loading it via
  //   `await import(...)` in `instrumentation.ts` makes Next correctly
  //   leave it out of the Edge bundle entirely.
  //
  // Both packages are listed as runtime `dependencies` in package.json
  // so a consumer's npm install pulls them as ordinary peers.
  noExternal: [],
  clean: true,
  sourcemap: true,
  target: 'node20',
  // Skip esbuild bundling diagnostics that aren't actionable for our case.
  splitting: false,
  // The workspace deps we DO inline (widget-bootstrap, core) themselves
  // import npm packages (playwright-core, ws, cross-spawn). Those have to
  // stay external — esbuild can't resolve playwright-core's dynamic
  // require of `chromium-bidi`, and even if it could, we don't want to
  // duplicate them into our bundle. Mark explicitly + add to runtime deps.
  external: ['react', 'react-dom', 'next', 'playwright-core', 'ws', 'cross-spawn'],
});
