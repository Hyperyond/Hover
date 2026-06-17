import type { NextConfig } from 'next';

/**
 * gethover.dev — Next app deployed to Vercel (NOT static export).
 *
 * It was `output: 'export'` while the site was pure marketing, but the Cloud
 * waitlist needs a server route (app/api/waitlist) to call Resend with a
 * secret key that must never reach the client — so the site now deploys as a
 * normal Next app on Vercel. The /docs pages are unaffected: they already use
 * generateStaticParams, so Next still statically prerenders them.
 */
const nextConfig: NextConfig = {
  trailingSlash: true,

  /**
   * 301s for retired blog posts. These URLs were indexed by Google, so a bare
   * delete would turn them into 404s (and "Not found" rows in Search Console).
   * Redirect each to the closest living post instead — keeps the link equity
   * and any external backlinks alive. Both pages covered a removed surface
   * (the `@hover-dev/cli` terminal path), so they point at the extension-era
   * equivalents.
   */
  async redirects() {
    return [
      {
        source: '/blog/generate-playwright-test-from-terminal',
        destination: '/blog/ai-authored-playwright-tests',
        permanent: true,
      },
      {
        source: '/blog/playwright-page-object-model-auto-extract',
        destination: '/blog/keep-playwright-tests-from-breaking',
        permanent: true,
      },
      // The orange "security" mode was renamed to "API testing"; its two feature
      // pages moved with it. These routes were indexed, so 301 the old slugs.
      {
        source: '/docs/features/security',
        destination: '/docs/features/api-test',
        permanent: true,
      },
      {
        source: '/docs/features/security-spec',
        destination: '/docs/features/api-test-spec',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
