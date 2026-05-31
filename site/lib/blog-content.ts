/**
 * Filesystem loader for blog MDX. Reads site/content/blog/*.mdx at build time
 * (server-only — used by generateStaticParams, the index, and the [slug] page).
 *
 * Each post is `content/blog/<slug>.mdx` with YAML frontmatter:
 *   ---
 *   title: "..."        # <h1> + <title> + OG title
 *   description: "..."  # meta description + index excerpt + OG description
 *   date: 2026-05-31    # ISO date, drives sort + Article JSON-LD
 *   author: "..."       # optional, defaults to "Hover"
 *   tags: [a, b]        # optional, shown as chips
 *   ---
 *
 * Slugs are flat (no nested dirs) so URLs are /blog/<slug>/ — clean for SEO.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

const ROOT = join(process.cwd(), 'content', 'blog');

export type PostMeta = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO
  author: string;
  tags: string[];
};

export type Post = PostMeta & { body: string };

function parse(slug: string, raw: string): Post {
  const { data, content } = matter(raw);
  return {
    slug,
    title: typeof data.title === 'string' ? data.title : slug,
    description: typeof data.description === 'string' ? data.description : '',
    // gray-matter parses unquoted YAML dates to Date objects; normalise to ISO.
    date:
      data.date instanceof Date
        ? data.date.toISOString().slice(0, 10)
        : typeof data.date === 'string'
          ? data.date
          : '1970-01-01',
    author: typeof data.author === 'string' ? data.author : 'Hover',
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    body: content,
  };
}

/** Every post slug, for generateStaticParams. */
export function allPostSlugs(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT)
    .filter((n) => n.endsWith('.mdx'))
    .map((n) => n.replace(/\.mdx$/, ''));
}

/** One post by slug, or null. */
export function readPost(slug: string): Post | null {
  const file = join(ROOT, `${slug}.mdx`);
  if (!existsSync(file)) return null;
  return parse(slug, readFileSync(file, 'utf8'));
}

/** All posts, newest first — for the index. */
export function allPosts(): Post[] {
  return allPostSlugs()
    .map((slug) => readPost(slug))
    .filter((p): p is Post => p !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
