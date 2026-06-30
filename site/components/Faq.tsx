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
    q: 'Do I have to learn a new tool or test format?',
    a: 'No. Hover is an MCP server you add to the coding agent you already run (Claude Code, Cursor, …) with one command — you keep working in the agent you know. Nothing changes in your app, your bundler config, or your dependencies, and the file you get is standard @playwright/test that any Playwright user can read.',
    answer: (
      <>
        No. Hover is an MCP server you add to the coding agent you already run
        (Claude Code, Cursor, …) with one command — you keep working in the
        agent you know. Nothing changes in your app, your bundler config, or your
        dependencies, and the file you get is standard <Code>@playwright/test</Code>{' '}
        that any Playwright user can read.
      </>
    ),
  },
  {
    q: 'Do I need the VS Code extension?',
    a: 'No. The MCP server is the whole authoring loop — add it to your own agent and you are done. The VS Code extension is an optional review cockpit: a Business Map graph of your app’s flows and coverage, and a Dashboard of pass / fail / flaky and CI results. It drives no agent.',
    answer: (
      <>
        No. The <Code>@hover-dev/mcp</Code> server is the whole authoring loop —
        add it to your own agent and you are done. The VS Code extension is an
        optional <em className="not-italic text-text">review cockpit</em>: a
        Business Map graph of your app&rsquo;s flows and coverage, and a Dashboard
        of pass / fail / flaky and CI results. It drives no agent.
      </>
    ),
  },
  {
    q: 'Do I need an API key or a credit card?',
    a: 'No, neither is required. Hover ships no model and resells no tokens. It rides on the Claude, Codex, Gemini, or Qwen plan whose CLI already sits on your PATH. Prefer your own key? Drop it into settings, optional and never required. CI runs plain Playwright with no AI at all.',
    answer: (
      <>
        No, neither is required. Hover ships no model and resells no tokens. It
        rides on the Claude, Codex, Gemini, or Qwen plan whose CLI already sits
        on your <Code>PATH</Code>. Prefer your own key? Drop it into settings,
        optional and never required. CI runs plain Playwright with no AI at all.
      </>
    ),
  },
  {
    q: 'My UI changed and a saved spec breaks. What now?',
    a: 'Most UI churn leaves the spec alone, because Hover writes semantic getByRole and getByLabel selectors instead of CSS or XPath. When the semantics genuinely change, you edit the plain Playwright file by hand or treat the failure as a regression the test caught for you. CI never calls a model to self-heal, which is what keeps it deterministic and free. On-failure self-heal of UI drift is coming with Hover Cloud, not the local extension.',
    answer: (
      <>
        Most UI churn leaves the spec alone, because Hover writes semantic{' '}
        <Code>getByRole</Code> and <Code>getByLabel</Code> selectors instead of
        CSS or XPath. When the{' '}
        <em className="not-italic text-text">semantics</em> genuinely change, you
        edit the plain Playwright file by hand or treat the failure as a
        regression the test caught for you. CI never calls a model to self-heal,
        which is what keeps it deterministic and free. On-failure self-heal of
        UI drift is coming with Hover Cloud, not the local extension.
      </>
    ),
  },
  {
    q: 'Does Hover upload my source code or DOM?',
    a: 'No. The coding-agent CLI on your PATH talks to its own provider; @hover-dev/core has no model SDK, no telemetry, and no upload path, and its Node service binds to 127.0.0.1 only. The agent drives an isolated debug Chrome on a temporary profile, never your main browser.',
    answer: (
      <>
        No. The coding-agent CLI on your <Code>PATH</Code> talks to its own
        provider; <Code>@hover-dev/core</Code> has no model SDK, no telemetry,
        and no upload path, and its Node service binds to{' '}
        <Code>127.0.0.1</Code> only. The agent drives an isolated debug Chrome on
        a temporary profile, never your main browser.
      </>
    ),
  },
  {
    q: 'Which AI agents and models can Hover use?',
    a: 'Any MCP-capable coding agent — Claude Code, Cursor, and others. Hover is an MCP server, so it rides whatever agent and model you already run on your own subscription or key. Hover bundles no model and holds no keys.',
    answer: (
      <>
        Any MCP-capable coding agent — <Code>Claude Code</Code>,{' '}
        <Code>Cursor</Code>, and others. Hover is an MCP server, so it rides
        whatever agent and model you already run on your own subscription or key.
        Hover bundles no model and holds no keys.
      </>
    ),
  },
  {
    q: 'What does "record == replay" actually mean?',
    a: 'The agent acts through Hover’s grounded browser tools (role+name → testId → text), so the selector that drove a click is the exact one written into the saved spec — and crystallization is deterministic, with no LLM writing code. There are no confabulated selectors: what you replay in CI is exactly what the agent recorded.',
    answer: (
      <>
        The agent acts through Hover&rsquo;s <em className="not-italic text-text">grounded</em>{' '}
        browser tools (<Code>role+name → testId → text</Code>), so the selector
        that drove a click is the exact one written into the saved spec — and
        crystallization is deterministic, with no LLM writing code. There are no
        confabulated selectors: what you replay in CI is exactly what the agent
        recorded.
      </>
    ),
  },
  {
    q: 'Why doesn’t CI pay for AI on every run?',
    a: 'Hover spends the model once, at authoring time. The saved artifact is plain @playwright/test code, so npx playwright test runs deterministically and free. Tools that self-heal by calling a model mid-run carry a permanent runtime dependency on a hosted provider; Hover keeps the token cost at the moment you author, never spread across thousands of green CI runs.',
    answer: (
      <>
        Hover spends the model once, at authoring time. The saved artifact is
        plain <Code>@playwright/test</Code> code, so{' '}
        <Code>npx playwright test</Code> runs deterministically and free. Tools
        that self-heal by calling a model mid-run carry a permanent runtime
        dependency on a hosted provider; Hover keeps the token cost at the moment
        you author, never spread across thousands of green CI runs.
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
