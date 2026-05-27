import { defineConfig } from 'tsup';

/**
 * Bundle config for `@hover-dev/next`.
 *
 * Why tsup (and not the plain `tsc` build every other Hover package uses):
 * Next 16 loads `next.config.mjs` via native Node `import()`, so the
 * package needs to be valid ESM with the right `exports` map at install
 * time. tsup gives us a single config knob for entry points, dts emission,
 * and target — cleaner than maintaining a `tsconfig.build.json` + sidecar
 * post-build steps for that.
 *
 * Notably we do NOT bundle the workspace dependency chain into the output.
 * Both `@hover-dev/core` and `@hover-dev/widget-bootstrap` stay external
 * and resolve via the consumer's `node_modules` at runtime:
 *
 * - `@hover-dev/widget-bootstrap` ships actual widget asset files
 *   (`dist/widget/{template.html,style.css,client.js,reducer.js}`) that
 *   its `reader.js` resolves at runtime via `import.meta.url`. If we
 *   inlined the JS into our bundle, `import.meta.url` would relocate to
 *   our `dist/` and those sibling asset files would be missing. The only
 *   safe shape is "keep widget-bootstrap external" so its own
 *   `dist/widget/...` sits next to its own `dist/reader.js`.
 *
 * - `@hover-dev/core` transitively imports `playwright-core`, which
 *   `require()`s `chromium-bidi` via a CJS path that Next's Edge bundler
 *   can't statically resolve. Even though our `register()` is gated to
 *   NEXT_RUNTIME === 'nodejs', Next compiles `instrumentation.js` for
 *   both runtimes and chokes on a static import chain at compile time.
 *   Keeping core external — combined with the string-variable-indirected
 *   `await import(...)` in `instrumentation.ts` (see CLAUDE.md "Edge
 *   runtime isolation") — lets Next correctly drop core from the Edge
 *   bundle entirely.
 *
 * Both are listed as runtime `dependencies` in `package.json` so a
 * consumer's npm install pulls them as ordinary deps. `react` / `next`
 * stay external too — they're peerDependencies and the host project is
 * the source of truth for their version.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/instrumentation.ts', 'src/register-node.ts'],
  // ESM + CJS. ESM is the long-term shape (Next 16+ Turbopack loads
  // `next.config.mjs` via native `import()`); CJS exists for Next 15's
  // `next.config.ts` loader, which transpiles the user's .ts config to
  // CommonJS and then `require()`s any package it imports — including
  // ours. Without a `"require"` condition in `exports`, Node's resolver
  // throws ERR_PACKAGE_PATH_NOT_EXPORTED before our register() ever runs.
  // The CJS output is genuinely callable: every Hover code path that
  // uses dynamic `import()` (instrumentation.ts string-variable
  // indirection, register-node's await import) still works under CJS —
  // dynamic import returns a Promise<ESM module namespace> in both runtimes.
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  // tsup auto-externalises everything listed in `dependencies` /
  // `peerDependencies`, but we list these explicitly for two reasons:
  // (1) it documents the npm packages tsup must NOT try to resolve into
  // its own bundle (esbuild's resolver chokes on playwright-core's
  // dynamic `require('chromium-bidi/...')`), and (2) it acts as a
  // canary — if someone removes one of these from `dependencies` and
  // forgets to update this list, the bundle still works the same way.
  external: ['react', 'react-dom', 'next', 'playwright-core', 'ws', 'cross-spawn'],
});
