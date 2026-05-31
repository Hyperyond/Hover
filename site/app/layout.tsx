import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hover — AI authors your tests, CI runs plain Playwright',
  description:
    'Describe a flow in plain English; AI drives your real Chrome once to explore, then crystallises a standard @playwright/test spec that runs in CI with zero AI, zero tokens. No API key — Hover spawns the coding-agent CLI you already pay for.',
  metadataBase: new URL('https://gethover.dev'),
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Hover — AI authors your tests, CI runs plain Playwright',
    description:
      'AI explores once, then hands off a deterministic Playwright spec. Zero AI at runtime, zero tokens in CI.',
    url: 'https://gethover.dev',
    siteName: 'Hover',
    type: 'website',
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
