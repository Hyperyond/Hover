import { withHover } from '@hover-dev/next';
import type { NextConfig } from 'next';

// next.config.ts on Next 15. This was the specific configuration that
// failed in v0.7.2 with ERR_PACKAGE_PATH_NOT_EXPORTED — Next 15 loads
// .ts configs through a CJS require() step and @hover-dev/next was
// ESM-only. v0.7.3 added a CJS dual-build so this loads cleanly.
const nextConfig: NextConfig = {};

export default withHover(nextConfig, {
  // Match the other Hover examples — first `next dev` auto-launches a
  // debug Chrome on :9222 navigated to this app, so the user sees the
  // floating ✨ widget immediately without an extra setup step.
  autoLaunchChrome: true,
  devUrl: 'http://localhost:5183/',
});
