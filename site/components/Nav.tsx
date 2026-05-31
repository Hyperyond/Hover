'use client';

import { useEffect, useState } from 'react';
import { Sparkle } from '@/components/Sparkle';

/* ── Site nav ────────────────────────────────────────────────────────────
 * Desktop: inline links + a GitHub button. Mobile (<md): a hamburger that
 * opens a full-width dropdown sheet. All section links are in-page anchors
 * (single long landing page); Docs is the one real route. The header is
 * sticky with a translucent blur so it stays reachable on a long page. */

const GITHUB = 'https://github.com/Hyperyond/Hover';
const DOCS = '/docs/';

const LINKS: { href: string; label: string }[] = [
  { href: '#how', label: 'How it works' },
  { href: '#comparison', label: 'Comparison' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
  { href: DOCS, label: 'Docs' },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  // Lock scroll while the mobile sheet is open; close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-line/60 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(124,255,168,0.5)] bg-bg text-mint shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
            <Sparkle size={18} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Hover</span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 text-[13px] text-text-mute md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 transition-colors hover:text-text"
            >
              {l.label}
            </a>
          ))}
          <a
            href={GITHUB}
            className="ml-2 flex items-center gap-1.5 rounded-md border border-line px-3 py-2 transition-colors hover:border-line-2 hover:text-text"
          >
            <GitHubGlyph /> GitHub
          </a>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-text-mute transition-colors hover:text-text md:hidden"
        >
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <nav className="border-t border-line bg-bg px-6 py-3 md:hidden">
          <div className="flex flex-col">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-3 text-[15px] text-text-mute transition-colors hover:text-text"
              >
                {l.label}
              </a>
            ))}
            <a
              href={GITHUB}
              onClick={() => setOpen(false)}
              className="mt-2 flex items-center gap-2 rounded-md border border-line px-3 py-3 text-[15px] text-text-mute transition-colors hover:border-line-2 hover:text-text"
            >
              <GitHubGlyph /> GitHub
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}

function GitHubGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
