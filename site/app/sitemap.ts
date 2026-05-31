import type { MetadataRoute } from 'next';
import { allDocSlugs } from '@/lib/docs-content';
import { allPosts } from '@/lib/blog-content';

const BASE = 'https://gethover.dev';

/**
 * Sitemap covering the landing page + every docs route + every blog post. Doc
 * and blog routes are derived from the same filesystem sources their pages
 * render from, so the sitemap can't drift from what actually exists. Submit
 * https://gethover.dev/sitemap.xml to Google Search Console.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const docRoutes = allDocSlugs().map((slug) => ({
    url: `${BASE}/docs/${slug.join('/')}/`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  const blogRoutes = allPosts().map((p) => ({
    url: `${BASE}/blog/${p.slug}/`,
    lastModified: new Date(`${p.date}T00:00:00Z`),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/blog/`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/docs/`, changeFrequency: 'weekly', priority: 0.8 },
    ...blogRoutes,
    ...docRoutes,
  ];
}
