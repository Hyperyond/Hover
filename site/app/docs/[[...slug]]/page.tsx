import Link from 'next/link';
import type { Metadata } from 'next';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { mdxComponents } from '@/components/docs/mdx-components';
import { allDocSlugs, readDoc, docTitle } from '@/lib/docs-content';
import { neighbours } from '@/lib/docs-nav';
import { DocsOverview } from '@/components/docs/Overview';

export const dynamicParams = false;

// One route per migrated mdx file, plus the empty slug for the /docs overview.
export function generateStaticParams() {
  return [{ slug: undefined }, ...allDocSlugs().map((slug) => ({ slug }))];
}

function hrefFor(slug?: string[]): string {
  return '/docs' + (slug && slug.length ? '/' + slug.join('/') : '');
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug?: string[] }> },
): Promise<Metadata> {
  const { slug } = await params;
  if (!slug || slug.length === 0) {
    // `absolute` opts out of the root layout's "%s · Hover" template so the
    // title isn't doubled (e.g. "… · Hover docs · Hover").
    return {
      title: { absolute: 'Hover docs' },
      description: 'Everything you need to author end-to-end tests with Hover.',
      alternates: { canonical: '/docs/' },
    };
  }
  const source = readDoc(slug);
  const title = source ? docTitle(source) : 'Docs';
  return {
    title: { absolute: `${title} · Hover docs` },
    alternates: { canonical: hrefFor(slug) },
  };
}

export default async function DocPage(
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;

  // /docs overview (no VitePress equivalent — index.md was a home layout)
  if (!slug || slug.length === 0) {
    return <DocsOverview />;
  }

  const source = readDoc(slug);
  if (!source) {
    return <p className="text-text-mute">Page not found.</p>;
  }

  const href = hrefFor(slug);
  const { prev, next } = neighbours(href);

  return (
    <article>
      <div className="prose-docs">
        <MDXRemote
          source={source}
          components={mdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
              rehypePlugins: [rehypeSlug],
            },
          }}
        />
      </div>

      {(prev || next) && (
        <nav className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-6 text-[14px]">
          {prev ? (
            <Link href={prev.href} className="group flex flex-col rounded-lg border border-line px-4 py-3 transition-colors hover:border-line-2">
              <span className="text-[12px] text-text-dim">← Previous</span>
              <span className="text-text-mute group-hover:text-text">{prev.text}</span>
            </Link>
          ) : <span />}
          {next ? (
            <Link href={next.href} className="group flex flex-col items-end rounded-lg border border-line px-4 py-3 text-right transition-colors hover:border-line-2">
              <span className="text-[12px] text-text-dim">Next →</span>
              <span className="text-text-mute group-hover:text-text">{next.text}</span>
            </Link>
          ) : <span />}
        </nav>
      )}
    </article>
  );
}
