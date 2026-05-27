import { withHover } from '@hover-dev/next';

// Minimal Next 16 App Router config. `withHover` is the idiomatic
// `with*` wrapper (matches `withMDX`, `withPlaywright`, `withNextIntl`).
// It writes the user's Hover options onto process.env so the
// instrumentation register() hook can read them at server boot.
//
// `.mjs` here is mostly historical — Next 15's `.ts` config path used
// to fail with ERR_PACKAGE_PATH_NOT_EXPORTED against our ESM-only
// `exports` map, which is why this example stuck with `.mjs`. v0.7.3+
// ships dual ESM + CJS so `.ts` works too (see
// `examples/turbo-monorepo/apps/web/next.config.ts` for the `.ts` path).

/** @type {import('next').NextConfig} */
const nextConfig = {
  // App router is the default in Next 13.4+, no flag needed.
};

export default withHover(nextConfig, {
  autoLaunchChrome: true,
  devUrl: 'http://localhost:5182/',
});
