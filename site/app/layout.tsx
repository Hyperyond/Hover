import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'Hover — AI authors your tests, CI runs plain Playwright';
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
    'Playwright',
    'end-to-end testing',
    'AI testing',
    'test automation',
    'Playwright spec',
    'browser testing',
    'CDP',
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
        alt: 'Hover — AI authors your tests, CI runs plain Playwright',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
