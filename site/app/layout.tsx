import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'Hover — open-source Vibe Testing suite, own the Playwright';
const DESCRIPTION =
  'Hover is an open-source Vibe Testing suite. Add its MCP server to the coding agent you already run (Claude Code, Cursor, …); the agent explores your app and crystallizes each flow into a plain @playwright/test spec you own, running in CI with zero AI. record == replay, BYO-CLI, no lock-in. An optional VS Code extension adds a Business Map + Dashboard review cockpit.';
const OG_DESCRIPTION =
  'Add Hover’s MCP to your own coding agent — it explores your app and crystallizes plain Playwright specs you own. record == replay, BYO-CLI, zero AI in CI.';

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
    'MCP',
    'Model Context Protocol',
    'Claude Code',
    'Cursor',
    'record equals replay',
    'BYO CLI',
    'VS Code extension',
    'open source',
    'CI testing',
    'natural language tests',
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
      sameAs: [
        'https://github.com/Hyperyond/Hover',
        'https://www.youtube.com/@hyperyond',
      ],
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
