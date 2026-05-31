import type { MetadataRoute } from 'next';
import { allDocSlugs } from '@/lib/docs-content';

const BASE = 'https://gethover.dev';

/**
 * Sitemap covering the landing page + every docs route. Doc routes are derived
 * from the same filesystem source the [[...slug]] page uses, so the sitemap
 * can't drift from what actually renders.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const docRoutes = allDocSlugs().map((slug) => ({
    url: `${BASE}/docs/${slug.join('/')}/`,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/docs/`, changeFrequency: 'weekly', priority: 0.8 },
    ...docRoutes,
  ];
}
