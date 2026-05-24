import { writeOptionsToEnv, type HoverOptions } from './options.js';

/**
 * Next.js `next.config.{mjs,ts}` wrapper. Idiomatic shape — matches
 * `withMDX`, `withNextIntl`, `withPlaywright`, etc. across the Next
 * ecosystem.
 *
 * Doesn't start the service. The actual service boot lives in the
 * `instrumentation.ts` `register()` hook (see `./instrumentation`),
 * because Next loads `next.config.*` during `next build` too — booting
 * a service here would leave an orphan on every CI build. `register()`
 * is Next's blessed dev/server-runtime init hook and is correctly
 * skipped at build time.
 *
 * What this function does: serialise the user's HoverOptions onto
 * `process.env`, since `register()` runs in a different Next-managed
 * lifecycle and env vars are the only side-effect-free channel that
 * crosses the boundary. The matching `register()` helper reads them
 * back out via `readOptionsFromEnv()`.
 *
 * TODO (Turbopack vercel/next.js#82945 — `.js`-extension import rewrite):
 *   When that issue lands, we can switch `@hover-dev/core` and
 *   `@hover-dev/widget-bootstrap` back to the workspace's standard
 *   "main: src/*.ts" entry convention (the same shape every other
 *   Hover package uses) and remove the dist-build watcher dance from
 *   `examples/next-app`'s dev flow. Until then those two packages
 *   carry a `dist`-shaped `exports` map AND a `dev: tsc --watch` script
 *   so Next's Turbopack can consume them as plain compiled `.js` files
 *   in monorepo dev.
 *
 * Usage:
 *
 *   // next.config.mjs
 *   import { withHover } from '@hover-dev/next';
 *   export default withHover({ // your existing next config });
 *
 * Or with options:
 *
 *   export default withHover({ // your config }, { autoLaunchChrome: true });
 */
export function withHover<T extends Record<string, unknown>>(
  nextConfig: T,
  options: HoverOptions = {},
): T {
  writeOptionsToEnv(options);
  return nextConfig;
}
