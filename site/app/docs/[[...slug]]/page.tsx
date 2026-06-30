import Link from 'next/link';
import type { Metadata } from 'next';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { mdxComponents } from '@/components/docs/mdx-components';
import { allDocSlugs, readDoc, docTitle, docDescription } from '@/lib/docs-content';
import { neighbours } from '@/lib/docs-nav';
import { DocsOverview } from '@/components/docs/Overview';

export const dynamicParams = false;

// One route per migrated mdx file, plus the empty slug for the /docs overview.
export function generateStaticParams() {
  return [{ slug: undefined }, ...allDocSlugs().map((slug) => ({ slug }))];
}

// Trailing slash to match trailingSlash:true — keeps the canonical and the
// prev/next links pointing at the real URL, not its 308 redirect.
function hrefFor(slug?: string[]): string {
  return slug && slug.length ? '/docs/' + slug.join('/') + '/' : '/docs/';
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
      description:
        'Add Hover’s MCP to your coding agent and crystallize plain Playwright specs you own. Install, the MCP tools, architecture, and the FAQ.',
      alternates: { canonical: '/docs/' },
    };
  }
  const source = readDoc(slug);
  const title = source ? docTitle(source) : 'Docs';
  const description = source ? docDescription(source) : undefined;
  const canonical = hrefFor(slug);
  return {
    title: { absolute: `${title} · Hover docs` },
    description,
    alternates: { canonical },
    openGraph: {
      title: `${title} · Hover docs`,
      description,
      url: `https://gethover.dev${canonical}`,
      type: 'article',
    },
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

  // BreadcrumbList JSON-LD — helps search + AI engines place the page in the
  // docs hierarchy. Home > Docs > section(s) > page.
  const crumbs = [
    { name: 'Home', url: 'https://gethover.dev/' },
    { name: 'Docs', url: 'https://gethover.dev/docs/' },
  ];
  let acc = '/docs';
  slug.forEach((seg, i) => {
    acc += `/${seg}`;
    const leaf = i === slug.length - 1;
    crumbs.push({
      name: leaf
        ? docTitle(source)
        : seg.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      url: `https://gethover.dev${acc}/`,
    });
  });
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
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
