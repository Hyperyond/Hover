'use client';

import { useState } from 'react';

/* ── Hero video ─────────────────────────────────────────────────────────
 * A click-to-load YouTube facade: we render the thumbnail + a play button and
 * only inject the privacy-mode (youtube-nocookie) iframe on click, so the page
 * stays fast and sets no Google cookies until the visitor opts in.
 *
 * Set the video by passing `id` (the 11-char YouTube id) from page.tsx. Until
 * a real walkthrough is recorded, leave `id` empty and a styled "coming"
 * placeholder shows instead of a broken embed. The README references
 * youtu.be/lQV5dmVWaIA — swap that id in once the final cut is up. */

export function VideoSection({ id = '', title = 'Watch Hover author a Playwright test in 90 seconds' }: { id?: string; title?: string }) {
  const [playing, setPlaying] = useState(false);
  const hasVideo = id.trim().length > 0;
  const thumb = hasVideo ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : '';

  return (
    <section id="watch" className="relative z-10 mx-auto max-w-5xl px-6 pb-8 pt-4">
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          See it run
        </div>
        <h2 className="mx-auto mt-3 max-w-2xl font-mono text-[24px] font-semibold leading-tight tracking-tight md:text-[30px]">
          {title}
        </h2>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-line bg-bg-3 shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
        {/* 16:9 frame */}
        <div className="relative aspect-video w-full">
          {playing && hasVideo ? (
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
              title={title}
              allow="accelerated-performance; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : hasVideo ? (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`Play video: ${title}`}
              className="group absolute inset-0 h-full w-full"
            >
              {/* thumbnail */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumb}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
              />
              <span className="absolute inset-0 bg-black/30" />
              <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(124,255,168,0.6)] bg-bg/80 text-mint backdrop-blur transition-transform group-hover:scale-110">
                <PlayGlyph />
              </span>
            </button>
          ) : (
            /* placeholder until the real video id is wired in */
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(60% 70% at 50% 35%, rgba(124,255,168,0.08), transparent 70%)',
                }}
              />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(124,255,168,0.4)] bg-bg/60 text-mint">
                <PlayGlyph />
              </span>
              <p className="relative font-mono text-[13px] text-text-dim">
                Walkthrough video — coming soon
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PlayGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}
