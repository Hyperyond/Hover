/* ── Hero video ─────────────────────────────────────────────────────────
 * The poster links out to the YouTube watch page (new tab). We deliberately do
 * NOT self-host or embed: a click-through keeps the page light (no 23MB asset,
 * no third-party iframe loading on the landing page) and sends watch time to
 * the channel. Pass the watch URL + a poster still from page.tsx.
 *
 * No 'use client' — it's a plain anchor + image, so it ships zero JS. */

type Props = {
  /** Full YouTube watch URL the poster links to. */
  watchUrl: string;
  /** Still image shown in the frame (e.g. "/demo-poster.jpg?v=hash"). */
  poster?: string;
  title?: string;
};

export function VideoSection({
  watchUrl,
  poster = '',
  title = 'Watch Hover author a Playwright test in 60 seconds',
}: Props) {
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

      <a
        href={watchUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Play on YouTube: ${title}`}
        className="group relative block overflow-hidden rounded-xl border border-line bg-bg-3 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
      >
        <div className="relative aspect-video w-full">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
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
          <span className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/20" />
          <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(124,255,168,0.6)] bg-bg/80 text-mint backdrop-blur transition-transform group-hover:scale-110">
            <PlayGlyph />
          </span>
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-bg/80 px-3 py-1 font-mono text-[11px] text-text-mute backdrop-blur transition-colors group-hover:text-text">
            Watch on YouTube ↗
          </span>
        </div>
      </a>
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
