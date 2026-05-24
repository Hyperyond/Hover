import { withHover } from '@hover-dev/next';

// Minimal Next 16 App Router config. `withHover` is the idiomatic
// `with*` wrapper (matches `withMDX`, `withPlaywright`, `withNextIntl`).
// It writes the user's Hover options onto process.env so the
// instrumentation register() hook can read them at server boot.
//
// Why .mjs and not .ts: Next 16's `next.config.ts` path runs a CJS
// `transpile-config` step that does `require()` on the compiled config,
// which doesn't honour the `"import"` condition in ESM-only packages'
// `exports` field — so it can't load `@hover-dev/next`'s ESM build. A
// `.mjs` config goes through Node's native `import()` instead, which
// resolves ESM exports correctly. See @hover-dev/next README.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // App router is the default in Next 13.4+, no flag needed.
};

export default withHover(nextConfig, {
  autoLaunchChrome: true,
  devUrl: 'http://localhost:5182/',
});
