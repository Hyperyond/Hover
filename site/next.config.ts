import type { NextConfig } from 'next';

/**
 * Static-export landing page for gethover.dev.
 *
 * `output: 'export'` emits a fully static site under `out/` — no Node server
 * at runtime, deployable to any CDN (Vercel, Cloudflare Pages, GitHub Pages).
 * The marketing page has no server-side needs; everything is pre-rendered.
 *
 * `images.unoptimized` is required under static export (no Image Optimization
 * server is available). We use plain assets, so this is a no-op safety net.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  // Trailing slashes keep static hosts happy when serving /foo as /foo/index.html.
  trailingSlash: true,
};

export default nextConfig;
