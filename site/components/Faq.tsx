'use client';

import { useState } from 'react';

/* ── FAQ ────────────────────────────────────────────────────────────────
 * Landing-page distillation of /docs/faq.mdx — answers are condensed from the
 * real doc, not invented. Each item also emits FAQPage JSON-LD (below) so the
 * questions are eligible for rich results / LLM answer engines. Keep the
 * plain-text `a` field in sync with the rendered `answer` if you edit copy. */

type Item = { q: string; a: string; answer: React.ReactNode };

const ITEMS: Item[] = [
  {
    q: 'My UI changed and a saved spec breaks. What now?',
    a: 'Most UI churn does not break the spec because Hover writes semantic getByRole / getByLabel selectors, not CSS or XPath. When the semantics actually shift, click ⟳ Re-record (or run hover re-record <spec>): the agent replays the original prompt against the current UI and rewrites the spec — about 30 seconds and ~$0.10. You can also edit the plain Playwright file by hand, or treat a real flow break as a regression the test correctly caught.',
    answer: (
      <>
        Most UI churn doesn&rsquo;t break the spec — Hover writes semantic{' '}
        <Code>getByRole</Code> / <Code>getByLabel</Code> selectors, never CSS or
        XPath. When the <em className="not-italic text-text">semantics</em> shift,
        click <span className="text-text">⟳ Re-record</span> (or{' '}
        <Code>hover re-record &lt;spec&gt;</Code>) — the agent replays the
        original prompt against the current UI and rewrites the spec in ~30 s for
        ~$0.10. You can also hand-edit the plain Playwright file, or treat a real
        flow break as a regression the test correctly caught.
      </>
    ),
  },
  {
    q: 'Does Hover send my source code or DOM to a hosted service?',
    a: 'No. Hover spawns the coding-agent CLI already on your local PATH (claude, codex, cursor-agent…) and that CLI talks to its own provider. @hover-dev/core has no LLM SDK, no telemetry, no upload path, and the Node service binds to 127.0.0.1 only.',
    answer: (
      <>
        No. Hover spawns the coding-agent CLI already on your local{' '}
        <Code>PATH</Code> (<Code>claude</Code>, <Code>codex</Code>,{' '}
        <Code>cursor-agent</Code>…) and that CLI talks to its own provider.{' '}
        <Code>@hover-dev/core</Code> has no LLM SDK, no telemetry, no upload path,
        and the Node service binds to <Code>127.0.0.1</Code> only.
      </>
    ),
  },
  {
    q: 'Why doesn’t CI pay for AI on every run?',
    a: 'Because Hover spends the model once, at authoring time. The saved artifact is plain @playwright/test code — npx playwright test is deterministic and free. Tools that self-heal by calling an LLM mid-run build a permanent runtime dependency on a hosted provider; Hover concentrates the token cost at the moment you author or re-record, never amortised across thousands of green CI runs.',
    answer: (
      <>
        Because Hover spends the model once, at authoring time. The saved
        artifact is plain <Code>@playwright/test</Code> code —{' '}
        <Code>npx playwright test</Code> is deterministic and free. Tools that
        self-heal by calling an LLM mid-run build a permanent runtime dependency
        on a hosted provider; Hover concentrates the token cost at authoring /
        re-record time, never amortised across thousands of green CI runs.
      </>
    ),
  },
  {
    q: 'Do I need to add a plugin or change my app?',
    a: 'No. Hover is a VS Code extension — install it from the Marketplace and nothing changes in your app, your bundler config, or your dependencies. The extension spawns a local engine that drives your existing dev server over CDP in an isolated debug Chrome. Whatever you build with — Vite, Next.js, Nuxt, Astro, webpack — the extension drives it unchanged.',
    answer: (
      <>
        No. Hover is a VS Code extension — install it from the Marketplace and
        nothing changes in your app, your bundler config, or your dependencies.
        The extension spawns a local engine that drives your existing dev server
        over CDP in an isolated debug Chrome. Whatever you build with — Vite,
        Next.js, Nuxt, Astro, webpack — the extension drives it unchanged.
      </>
    ),
  },
  {
    q: 'Do I need an API key or a credit card?',
    a: 'No — neither is required. Hover bundles no AI runtime and resells no tokens; it rides on the Claude Pro / Max or ChatGPT plan whose CLI is already on your PATH. No signup, no card. Prefer not to use a subscription? Drop your own model API key into the extension settings — optional, never required. CI runs plain Playwright with no AI at all.',
    answer: (
      <>
        No &mdash; neither is required. Hover bundles no AI runtime and resells
        no tokens; it rides on the Claude Pro / Max or ChatGPT plan whose CLI is
        already on your <Code>PATH</Code>. No signup, no card. Prefer not to use
        a subscription? Drop your own model API key into the extension settings
        &mdash; optional, never required. CI runs plain Playwright with no AI at
        all.
      </>
    ),
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ITEMS.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  };

  return (
    <section id="faq" className="relative z-10 mx-auto max-w-3xl px-6 py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
        <span className="h-1.5 w-1.5 rounded-full bg-mint" />
        FAQ
      </div>
      <h2 className="mt-4 font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        Questions, answered <span className="text-mint">straight</span>.
      </h2>

      <div className="mt-10 divide-y divide-line overflow-hidden rounded-lg border border-line">
        {ITEMS.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={it.q} className="bg-bg-2/40">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-bg-2"
              >
                <span className="text-[15px] font-medium leading-snug text-text">{it.q}</span>
                <span
                  className="shrink-0 font-mono text-[18px] leading-none text-text-dim transition-transform"
                  style={{ transform: isOpen ? 'rotate(45deg)' : 'none' }}
                  aria-hidden
                >
                  +
                </span>
              </button>
              {isOpen && (
                <div className="px-5 pb-5 text-[14px] leading-relaxed text-text-mute">
                  {it.answer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[12.5px] text-mint">
      {children}
    </code>
  );
}
