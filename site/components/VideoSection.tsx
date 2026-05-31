'use client';

import { useRef, useState } from 'react';

/* ── Hero video ─────────────────────────────────────────────────────────
 * Two playback modes, picked by which prop you pass from page.tsx:
 *
 *   • src   — a self-hosted file under public/ (e.g. "/demo.mp4"). Rendered
 *             with a native <video>. PREFERRED: no third party, no ad-block
 *             friction, and immune to YouTube's "sign in to confirm you're
 *             not a bot" wall, which YouTube can slap on a freshly-uploaded
 *             or low-view video at the server level — unbeatable from the
 *             client (verified: the watch page returns status:LOGIN_REQUIRED
 *             for our clip while other public videos return OK from the same
 *             origin, so it's a per-video YouTube flag, not our embed code).
 *   • id    — an 11-char YouTube id. Fallback only. Click-to-load facade so
 *             the page stays fast, but subject to the gate above.
 *   • neither — a styled "coming soon" placeholder.
 *
 * `src` wins if both are set. `poster` is the still shown before play; for the
 * <video> path it defaults to the YouTube thumbnail when an id is also given,
 * else pass a public/ image path. */

type Props = {
  src?: string;
  id?: string;
  poster?: string;
  title?: string;
};

export function VideoSection({
  src = '',
  id = '',
  poster = '',
  title = 'Watch Hover author a Playwright test in 90 seconds',
}: Props) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const hasFile = src.trim().length > 0;
  const hasYouTube = id.trim().length > 0;
  const ytThumb = hasYouTube ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : '';
  const stillSrc = poster || ytThumb;

  const startFile = () => {
    setPlaying(true);
    // Kick playback once the element mounts/controls show.
    requestAnimationFrame(() => videoRef.current?.play().catch(() => {}));
  };

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
          {/* ── Self-hosted file (preferred) ─────────────────────────── */}
          {hasFile ? (
            playing ? (
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full bg-black"
                src={src}
                poster={stillSrc || undefined}
                controls
                autoPlay
                playsInline
                preload="metadata"
              />
            ) : (
              <PlayFacade
                title={title}
                still={stillSrc}
                onPlay={startFile}
              />
            )
          ) : /* ── YouTube fallback ──────────────────────────────────── */
          hasYouTube ? (
            playing ? (
              <iframe
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`}
                title={title}
                allow="autoplay; accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
              />
            ) : (
              <PlayFacade
                title={title}
                still={ytThumb}
                onPlay={() => setPlaying(true)}
              />
            )
          ) : (
            /* ── Placeholder until a video is wired in ─────────────── */
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

/* Shared click-to-play poster: a still image (or solid backdrop) + a centered
 * mint play button. Used by both the file and YouTube paths. */
function PlayFacade({
  title,
  still,
  onPlay,
}: {
  title: string;
  still: string;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Play video: ${title}`}
      className="group absolute inset-0 h-full w-full bg-black"
    >
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={still}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 70% at 50% 35%, rgba(124,255,168,0.1), transparent 70%)',
          }}
        />
      )}
      <span className="absolute inset-0 bg-black/30" />
      <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(124,255,168,0.6)] bg-bg/80 text-mint backdrop-blur transition-transform group-hover:scale-110">
        <PlayGlyph />
      </span>
    </button>
  );
}

function PlayGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}
