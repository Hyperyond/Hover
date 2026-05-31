import Link from 'next/link';
import type { Metadata } from 'next';
import { allPosts } from '@/lib/blog-content';

export const metadata: Metadata = {
  title: { absolute: 'Blog · Hover' },
  description:
    'Notes on AI-authored testing, Playwright, and shipping deterministic end-to-end tests — from the team building Hover.',
  alternates: { canonical: '/blog/' },
  openGraph: {
    title: 'Hover Blog',
    description:
      'Notes on AI-authored testing, Playwright, and shipping deterministic end-to-end tests.',
    url: 'https://gethover.dev/blog/',
    type: 'website',
  },
};

function fmtDate(iso: string): string {
  // Build-time only; format without a locale dependency.
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!y || !m || !d) return iso;
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function BlogIndex() {
  const posts = allPosts();

  // Blog JSON-LD so search + answer engines see this as a post collection.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Hover Blog',
    url: 'https://gethover.dev/blog/',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.description,
      datePublished: p.date,
      url: `https://gethover.dev/blog/${p.slug}/`,
    })),
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
      />

      <div className="mb-12">
        <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          Blog
        </div>
        <h1 className="mt-4 font-mono text-[32px] font-semibold leading-tight tracking-tight text-text md:text-[40px]">
          Notes on testing the AI way.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-mute">
          How AI exploration, Playwright, and deterministic CI fit together — and
          the design decisions behind Hover.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-text-mute">No posts yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/blog/${p.slug}/`}
                className="group block py-7 transition-colors"
              >
                <div className="flex items-center gap-3 text-[12px] text-text-dim">
                  <time dateTime={p.date}>{fmtDate(p.date)}</time>
                  {p.tags.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.tags.map((t) => (
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
                <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-text transition-colors group-hover:text-mint">
                  {p.title}
                </h2>
                <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-text-mute">
                  {p.description}
                </p>
                <span className="mt-3 inline-block text-[13px] text-text-dim transition-colors group-hover:text-text">
                  Read →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
