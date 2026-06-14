import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { mdxComponents } from '@/components/docs/mdx-components';
import { allPostSlugs, readPost } from '@/lib/blog-content';

export const dynamicParams = false;

export function generateStaticParams() {
  return allPostSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = readPost(slug);
  if (!post) return { title: { absolute: 'Not found · Hover' } };
  const url = `https://gethover.dev/blog/${slug}/`;
  return {
    title: { absolute: `${post.title} · Hover` },
    description: post.description,
    alternates: { canonical: `/blog/${slug}/` },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  };
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return iso;
  return `${months[m - 1]} ${d}, ${y}`;
}

export default async function BlogPost(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = readPost(slug);
  if (!post) notFound();

  const url = `https://gethover.dev/blog/${slug}/`;

  // BlogPosting JSON-LD — rich results + LLM answer-engine citation.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: post.author },
    publisher: { '@type': 'Organization', name: 'Hover', url: 'https://gethover.dev' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: 'https://gethover.dev/og.png',
    url,
  };

  return (
    <article>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />

      <Link
        href="/blog"
        className="inline-block text-[13px] text-text-dim transition-colors hover:text-text"
      >
        ← All posts
      </Link>

      <div className="mt-6 flex items-center gap-3 text-[12px] text-text-dim">
        <time dateTime={post.date}>{fmtDate(post.date)}</time>
        {post.tags.length > 0 && (
          <>
            <span>·</span>
            <span className="flex flex-wrap gap-1.5">
              {post.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-text-mute"
                >
                  {t}
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      <div className="prose-docs mt-3">
        <MDXRemote
          source={post.body}
          components={mdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
              rehypePlugins: [rehypeSlug],
            },
          }}
        />
      </div>

      <div className="mt-14 rounded-xl border border-[rgba(124,255,168,0.3)] bg-bg-2 px-7 py-8 text-center">
        <p className="font-mono text-[18px] font-semibold tracking-tight text-text">
          Try Hover on your own app.
        </p>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-text-mute">
          Install the VS Code extension. Author tests with AI, ship plain
          Playwright.
        </p>
        <a
          href="https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev"
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-block rounded-md border border-[rgba(124,255,168,0.5)] bg-mint px-5 py-2.5 font-mono text-[14px] font-semibold text-bg transition-all hover:bg-[#5cf094]"
        >
          Install on VS Code Marketplace →
        </a>
      </div>
    </article>
  );
}
