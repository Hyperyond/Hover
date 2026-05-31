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
};

export default nextConfig;
