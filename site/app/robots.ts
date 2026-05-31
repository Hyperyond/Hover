import type { MetadataRoute } from 'next';

/**
 * Allow all crawlers everywhere except the API route, and point them at the
 * sitemap. GEO note: we deliberately do NOT block AI crawlers (GPTBot,
 * ClaudeBot, etc.) — we want Hover to be citable by LLM search.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/api/' }],
    sitemap: 'https://gethover.dev/sitemap.xml',
    host: 'https://gethover.dev',
  };
}
