import { ImageResponse } from 'next/og';

/**
 * Dynamically-generated Open Graph / Twitter share image (1200×630). Next
 * renders this to a PNG at build time, so there's no hand-made asset to keep
 * in sync. Uses the site palette (near-black + mint) so the share card reads
 * as Hover. Replaces the /og.png referenced in layout metadata for the home
 * route; per-route files can override it later.
 */
export const runtime = 'nodejs';
export const alt = 'Hover — AI authors your tests, CI runs plain Playwright';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: '#0a0a0a',
          backgroundImage:
            'radial-gradient(60% 80% at 50% 0%, rgba(124,255,168,0.18), transparent 70%)',
        }}
      >
        {/* mark + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 40 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              border: '2px solid rgba(124,255,168,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* The widget's four-point sparkle, drawn as SVG so OG rendering
                doesn't need a font for a glyph like ✦ (that fails offline). */}
            <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="#7CFFA8" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 2v6M10 12v6M2 10h6M12 10h6" />
              <path d="M4.5 4.5l2 2M13.5 13.5l2 2M4.5 15.5l2-2M13.5 6.5l2-2" opacity={0.55} />
            </svg>
          </div>
          <div style={{ fontSize: 30, color: '#e5e7eb', fontWeight: 600 }}>Hover</div>
        </div>

        <div
          style={{
            fontSize: 60,
            fontWeight: 700,
            lineHeight: 1.1,
            color: '#fafafa',
            letterSpacing: '-0.02em',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <span>AI authors the test.</span>
          <span style={{ color: '#7CFFA8' }}>CI runs plain Playwright.</span>
        </div>

        <div style={{ marginTop: 36, fontSize: 26, color: '#9ca3af', maxWidth: 900 }}>
          Drive your real browser in plain English, then ship a deterministic
          @playwright/test spec. Open-source · no API key.
        </div>

        <div style={{ marginTop: 'auto', fontSize: 24, color: '#6b7280' }}>gethover.dev</div>
      </div>
    ),
    size,
  );
}
