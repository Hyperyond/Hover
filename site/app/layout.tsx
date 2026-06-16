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

/* ── GEO / structured data ───────────────────────────────────────────────
 * JSON-LD that hands search engines AND generative engines (LLM answer
 * boxes) clean, quotable, declarative facts about what Hover is. Every claim
 * here must match the shipped product — these strings get quoted verbatim.
 * SoftwareApplication = the rich-result card; FAQPage = the Q&A an LLM lifts
 * when a user asks "what is Hover / how is it different / what does it cost". */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'Hover',
      alternateName: 'Hover — AI Vibe Testing',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Windows, Linux',
      description:
        'Hover is an open-source VS Code extension for AI vibe-testing web apps. You describe a flow in plain English; Hover drives your real Chrome over CDP using the coding-agent CLI already on your machine (Claude Code or OpenAI Codex), then crystallizes the verified run into a plain @playwright/test spec that runs in CI with zero AI and zero tokens.',
      url: 'https://gethover.dev',
      downloadUrl:
        'https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev',
      softwareHelp: 'https://gethover.dev/docs',
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      author: { '@type': 'Organization', name: 'Hyperyond' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      keywords:
        'vibe testing, AI testing, Playwright, end-to-end testing, VS Code extension, AI security testing, pentest',
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is Hover?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Hover is an open-source VS Code extension that turns plain-English chat into end-to-end tests. AI drives your real Chrome once to explore a flow, then Hover crystallizes the verified run into a standard @playwright/test spec that runs in CI with no AI in the loop.',
          },
        },
        {
          '@type': 'Question',
          name: 'How is Hover different from other AI testing tools?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Other AI test tools keep a model in the loop at runtime and re-generate the test on every run, so CI keeps paying for tokens and results drift. Hover spends the model once, at authoring time, and the artifact it leaves behind is deterministic, human-readable @playwright/test code. Green builds never pay a recurring AI tax.',
          },
        },
        {
          '@type': 'Question',
          name: 'What does Hover cost to run?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Hover is free and open source. It bundles no model SDK and no API keys — it spawns the coding-agent CLI (Claude Code or OpenAI Codex) already on your PATH, running on your own subscription or API key. There is no per-token resale.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can Hover do security testing?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. The same chat flips into a security mode (IDOR / authz probing that crystallizes confirmed findings into .security.spec.ts CI gates) and a pentest mode (offensive, white-box, own-app-only — SQLi / XSS / SSTI / SSRF — writing a findings report).',
          },
        },
      ],
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
