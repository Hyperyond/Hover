import type { Metadata } from 'next';
import './globals.css';

const TITLE = 'Hover — AI authors your tests, CI runs plain Playwright';
const DESCRIPTION =
  'Describe a flow in plain English; AI drives your real Chrome once to explore, then crystallises a standard @playwright/test spec that runs in CI with zero AI, zero tokens. No API key — Hover spawns the coding-agent CLI you already pay for.';
const OG_DESCRIPTION =
  'AI explores once, then hands off a deterministic Playwright spec. Zero AI at runtime, zero tokens in CI.';

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
    'Vite plugin',
    'open source',
    'CI testing',
    'natural language tests',
  ],
  authors: [{ name: 'Hyperyond' }],
  creator: 'Hyperyond',
  icons: { icon: '/favicon.svg' },
  alternates: { canonical: '/' },
  // OG/Twitter images are supplied by app/opengraph-image.tsx (Next injects
  // them automatically) — no manual `images` needed here.
  openGraph: {
    title: TITLE,
    description: OG_DESCRIPTION,
    url: 'https://gethover.dev',
    siteName: 'Hover',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: OG_DESCRIPTION,
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
