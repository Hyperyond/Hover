/**
 * Filesystem loader for docs MDX. Reads site/content/docs/**.mdx at build time
 * (server-only — used by generateStaticParams + the page component under
 * `output: export`). Slug ↔ file mapping:
 *   /docs                          → content/docs/<section>/index? no — overview is its own page
 *   /docs/get-started              → content/docs/get-started/index.mdx
 *   /docs/get-started/install      → content/docs/get-started/install.mdx
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'content', 'docs');

/** All slug arrays for static generation, e.g. ['get-started','install']. */
export function allDocSlugs(): string[][] {
  const slugs: string[][] = [];
  const walk = (dir: string, prefix: string[]) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, [...prefix, name]);
      } else if (name.endsWith('.mdx')) {
        const base = name.replace(/\.mdx$/, '');
        slugs.push(base === 'index' ? prefix : [...prefix, base]);
      }
    }
  };
  walk(ROOT, []);
  return slugs;
}

/** Resolve a slug array to the MDX source string, or null if not found. */
export function readDoc(slug: string[]): string | null {
  // try <slug>.mdx then <slug>/index.mdx
  const direct = join(ROOT, ...slug) + '.mdx';
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  const indexed = join(ROOT, ...slug, 'index.mdx');
  if (existsSync(indexed)) return readFileSync(indexed, 'utf8');
  return null;
}

/** First # heading in the MDX, used as the page <title> + breadcrumb. */
export function docTitle(source: string): string {
  const m = source.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : 'Docs';
}
