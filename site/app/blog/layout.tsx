import Link from 'next/link';
import { Sparkle } from '@/components/Sparkle';

/** Shared chrome for /blog pages: a top bar matching the docs header, then a
 * centered reading column. Kept deliberately simple — the blog has no sidebar
 * (the index is the navigation). */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-[var(--color-bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(124,255,168,0.5)] bg-bg text-mint">
              <Sparkle size={16} />
            </span>
            <span className="text-[14px] font-semibold tracking-tight">Hover</span>
            <span className="text-text-dim">/</span>
            <Link href="/blog" className="text-[13px] text-text-mute transition-colors hover:text-text">
              blog
            </Link>
          </Link>
          <span className="flex-1" />
          <Link href="/" className="text-[13px] text-text-mute transition-colors hover:text-text">
            ← Home
          </Link>
          <Link href="/docs/" className="text-[13px] text-text-mute transition-colors hover:text-text">
            Docs
          </Link>
          <a
            href="https://github.com/Hyperyond/Hover"
            className="text-[13px] text-text-mute transition-colors hover:text-text"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">{children}</main>
    </div>
  );
}
