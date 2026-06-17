import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'Hover — Vibe-test your app, CI runs plain Playwright';
const DESCRIPTION =
  'A VS Code extension: chat to a test in your editor. AI drives your real Chrome once to explore a flow, then crystallises a standard @playwright/test spec that runs in CI with zero AI, zero tokens. Hover spawns the coding-agent CLI on your PATH — your subscription or your own API key.';
const OG_DESCRIPTION =
  'A VS Code extension — AI explores once, then hands off a deterministic Playwright spec. Zero AI at runtime, zero tokens in CI.';

export const metadata: Metadata = {
  metadataBase: new URL('https://gethover.dev'),
  title: {
    default: TITLE,
    template: '%s · Hover',
  },
  description: DESCRIPTION,
  applicationName: 'Hover',
  keywords: [
    'vibe testing',
    'vibe-test',
    'vibe coding',
    'AI testing',
    'Playwright',
    'end-to-end testing',
    'test automation',
    'Playwright spec',
    'browser testing',
    'CDP',
    'VS Code extension',
    'open source',
    'CI testing',
    'natural language tests',
    'AI security testing',
    'pentest',
  ],
  authors: [{ name: 'Hyperyond' }],
  creator: 'Hyperyond',
  icons: { icon: '/favicon.svg' },
  alternates: { canonical: '/' },
  // OG/Twitter share image is a real static PNG under public/og.png — NOT the
  // dynamic /opengraph-image route. A static export (this site deploys to
  // gethover.dev as static HTML) cannot serve a dynamic image endpoint, so
  // social scrapers would 404 on it and show no preview. A plain file always
  // resolves. 1734×907 (1.91:1, the OG/Twitter recommended ratio).
  openGraph: {
    title: TITLE,
    description: OG_DESCRIPTION,
    url: 'https://gethover.dev',
    siteName: 'Hover',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1734,
        height: 907,
        alt: 'Hover — Vibe-test your app, CI runs plain Playwright',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: OG_DESCRIPTION,
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

/* ── Sitewide identity (GEO / structured data) ───────────────────────────
 * Only the site-level identity lives here, because this renders on EVERY route:
 * Organization + WebSite. Page-specific schema is scoped to the page that owns
 * it — SoftwareApplication on the homepage (app/page.tsx), FAQPage on the
 * homepage FAQ (components/Faq.tsx, where the Q&A is actually visible),
 * BreadcrumbList on docs, BlogPosting on posts. That keeps each entity on the
 * one page whose visible content it describes (a rich-results requirement) and
 * avoids duplicate SoftwareApplication / FAQPage nodes. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://gethover.dev/#org',
      name: 'Hyperyond',
      url: 'https://gethover.dev',
      logo: 'https://gethover.dev/favicon.svg',
      sameAs: ['https://github.com/Hyperyond/Hover'],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://gethover.dev/#website',
      name: 'Hover',
      url: 'https://gethover.dev',
      inLanguage: 'en',
      publisher: { '@id': 'https://gethover.dev/#org' },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
      </body>
    </html>
  );
}
