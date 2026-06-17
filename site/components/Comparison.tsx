'use client';

import { useState } from 'react';

/* ── Honest competitive comparison ──────────────────────────────────────
 * Every cell here was fact-checked against each vendor's OWN docs/site/repo in
 * 2026 (sources linked per column under the table). Accuracy rules — do NOT
 * "round up" against competitors:
 *   - QA Wolf / Momentic publish NO public pricing. Describe the model
 *     ("managed contract" / "quote-based"); never quote a number (the figures
 *     online are third-party aggregator estimates).
 *   - Momentic DOES save a portable artifact — YAML in your repo — but its AI
 *     interprets those steps at runtime; it does not export Playwright. So the
 *     "plain Playwright, no AI in CI" row is NO, but the note must say "YAML +
 *     runtime AI", not "no code at all" (which was wrong).
 *   - Stagehand v3 dropped its Playwright dependency; the artifact is a
 *     Stagehand script. Cached actions replay WITHOUT an LLM, but the AI
 *     fallback stays wired into the runtime. Phrase as "cached replay is
 *     LLM-free, AI fallback stays in the loop" — NOT "needs AI every run".
 *   - Midscene: same nuance — caching reduces, does not eliminate, runtime AI.
 *   - QA Wolf is a managed service: their engineers + AI author the tests, so
 *     "AI authors from intent" is PARTIAL, not a flat yes/no.
 * If you change a cell, re-verify against the source before shipping. */

type Cell = { v: 'yes' | 'no' | 'partial' | 'na'; note: string };

type Row = {
  dim: string;
  hover: Cell;
  cols: Cell[]; // Momentic, QA Wolf, Playwright codegen, Stagehand, Midscene
};

const COMPETITORS = ['Momentic', 'QA Wolf', 'Playwright codegen', 'Stagehand', 'Midscene'];

/** Per-vendor source for the footnote — what each column was checked against. */
const SOURCES: { name: string; href: string }[] = [
  { name: 'Momentic', href: 'https://momentic.ai/docs' },
  { name: 'QA Wolf', href: 'https://www.qawolf.com/' },
  { name: 'Playwright codegen', href: 'https://playwright.dev/docs/codegen' },
  { name: 'Stagehand', href: 'https://github.com/browserbase/stagehand' },
  { name: 'Midscene', href: 'https://github.com/web-infra-dev/midscene' },
];

const yes = (note: string): Cell => ({ v: 'yes', note });
const no = (note: string): Cell => ({ v: 'no', note });
const partial = (note: string): Cell => ({ v: 'partial', note });
const na = (note: string): Cell => ({ v: 'na', note });

const ROWS: Row[] = [
  {
    dim: 'AI authors the test from intent',
    hover: yes('Agent explores the flow from one English sentence'),
    cols: [
      yes('Natural-language prompts; AI turns them into steps'),
      partial('Their QA engineers + AI author it for you'),
      no('Deterministic recorder — transcribes clicks, cannot explore'),
      yes('act / agent take intent; AI plans the steps'),
      yes('Vision model plans and locates from screenshots'),
    ],
  },
  {
    dim: 'Output is plain Playwright that runs in CI with NO AI',
    hover: yes('Standard @playwright/test .spec.ts, agent-free forever'),
    cols: [
      no('YAML in your repo, but AI interprets it at runtime'),
      yes('Real, exportable Playwright code — yours to keep'),
      yes('Standard .spec.ts; no AI at author- or run-time'),
      no('Stagehand script — cached replay is LLM-free, AI fallback stays in the loop'),
      no('Own JS / YAML; needs Midscene runtime + AI (caching reduces, not eliminates)'),
    ],
  },
  {
    dim: 'Generated spec guards every step',
    hover: yes('Each interaction prefaced with an explicit expect(el).toBeVisible()'),
    cols: [
      na('No code artifact — YAML interpreted by AI at runtime'),
      partial('Hand / AI-written Playwright; a per-step guard isn\'t guaranteed'),
      no('Records raw actions; a visibility assert needs a manual toolbar click'),
      no('Runtime SDK — leans on Playwright auto-wait, no guard in the saved code'),
      no('Runtime vision agent; asserts only where you write aiAssert'),
    ],
  },
  {
    dim: 'Structured output — Page Objects, test.step, fixtures',
    hover: yes('Lifts repeated flows into Page Objects + fixtures; wraps each step in test.step'),
    cols: [
      na('No code artifact — runtime YAML'),
      partial('Exportable Playwright, but you organise its structure by hand'),
      no('Flat recorded script — no Page Objects or test.step stages'),
      no('Stagehand script; no Page Object extraction'),
      no('Own JS / YAML; no Page Object extraction'),
    ],
  },
  {
    dim: 'Optional AI polish pass (diff-reviewed, original kept)',
    hover: yes('Deterministic draft first, then an opt-in AI pass you accept via diff'),
    cols: [
      na('Runtime-AI YAML — nothing deterministic to polish'),
      na('Managed — their team maintains the suite'),
      no('Deterministic recorder — no AI authoring or polishing'),
      no('AI stays in the loop; no deterministic draft to diff against'),
      no('Runtime AI; no separate original to optimize'),
    ],
  },
  {
    dim: 'Built-in pattern library (optimization + security)',
    hover: yes('A curated library of worked examples and probes ships built-in — no setup, no plugin code'),
    cols: [
      no('Closed platform; no user-extensible translation layer'),
      na('Managed — you do not author the translation'),
      na('No translation layer — it transcribes clicks'),
      no('AI re-plans each run; no shareable pattern library'),
      no('Vision agent re-plans each run; no shareable pattern library'),
    ],
  },
  {
    dim: 'Open source / self-hosted',
    hover: yes('Apache-2.0, runs entirely on your machine'),
    cols: [
      no('Closed SaaS; local CLI still needs a Momentic account'),
      no('Managed service; the platform is not self-hostable'),
      yes('Apache-2.0 (part of Playwright)'),
      yes('MIT; runs fully local without Browserbase cloud'),
      yes('MIT; runs locally, bring your own model endpoint'),
    ],
  },
  {
    dim: 'Bring-your-own AI (your CLI / model key)',
    hover: yes('Spawns the claude / codex CLI already on your PATH'),
    cols: [
      no('Vendor-hosted AI; you supply a Momentic API key'),
      na('Managed — AI is internal to their team'),
      na('No AI involved at all'),
      yes('Any structured-output LLM — OpenAI / Anthropic / local'),
      yes('Any OpenAI-compatible / VL endpoint you configure'),
    ],
  },
  {
    dim: 'Drives your real local dev server',
    hover: yes('A VS Code extension drives your existing dev server over CDP — nothing added to your app'),
    cols: [
      partial('CLI runs locally / in CI, but tied to the hosted account'),
      no('Runs the suite on QA Wolf’s own cloud infra'),
      yes('Records against any local URL in a real browser'),
      yes('Local Chrome by default; Browserbase cloud optional'),
      yes('Local via Playwright / Puppeteer or Bridge Mode'),
    ],
  },
  {
    dim: 'Pricing',
    hover: yes('Free / OSS — you pay only the CLI plan you already have'),
    cols: [
      no('Quote-based; no public pricing, free trial only'),
      no('Managed contract; no public pricing on their site'),
      yes('Free / OSS'),
      yes('SDK free (MIT); Browserbase cloud is a separate paid add-on'),
      yes('Free / OSS — you pay only your own model usage'),
    ],
  },
];

const ICON: Record<Cell['v'], { glyph: string; color: string; label: string }> = {
  yes: { glyph: '✓', color: 'var(--color-mint)', label: 'Yes' },
  no: { glyph: '✕', color: 'var(--color-error)', label: 'No' },
  partial: { glyph: '◐', color: 'var(--color-warn)', label: 'Partial' },
  na: { glyph: '–', color: 'var(--color-text-dim)', label: 'Not applicable' },
};

function CellMark({ cell, emphasised }: { cell: Cell; emphasised?: boolean }) {
  const i = ICON[cell.v];
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <span
        className="font-mono text-[15px] leading-none"
        style={{ color: emphasised && cell.v === 'yes' ? 'var(--color-mint)' : i.color }}
        aria-label={i.label}
      >
        {i.glyph}
      </span>
      <span className="text-[11px] leading-snug text-text-dim">{cell.note}</span>
    </div>
  );
}

export function Comparison() {
  // The full row notes are dense; on narrow screens we collapse to glyph-only
  // and expand the active competitor in a stacked card below the matrix.
  const [active, setActive] = useState(0);

  return (
    <section id="comparison" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>How Hover compares</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        The only tool that pairs AI exploration with a{' '}
        <span className="text-mint">portable, agent-free artifact</span>.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        We checked every cell against each vendor&rsquo;s own docs. Where a tool
        publishes no public pricing, we say so instead of guessing a number.
      </p>

      {/* ── Desktop matrix (md+) ─────────────────────────────────────── */}
      <div className="mt-12 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              <th className="w-[260px] border-b border-line px-4 py-4 text-left align-bottom" />
              <th className="border-b border-l border-[rgba(124,255,168,0.35)] bg-[rgba(124,255,168,0.06)] px-4 py-4 align-bottom">
                <div className="flex items-center justify-center gap-2 font-mono text-[14px] font-semibold text-mint">
                  Hover
                </div>
              </th>
              {COMPETITORS.map((c) => (
                <th
                  key={c}
                  className="border-b border-l border-line px-4 py-4 align-bottom text-[13px] font-medium text-text-mute"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.dim} className="align-top">
                <th
                  scope="row"
                  className="border-b border-line px-4 py-5 text-left text-[13.5px] font-medium leading-snug text-text"
                >
                  {r.dim}
                </th>
                <td className="border-b border-l border-[rgba(124,255,168,0.35)] bg-[rgba(124,255,168,0.06)] px-4 py-5">
                  <CellMark cell={r.hover} emphasised />
                </td>
                {r.cols.map((cell, i) => (
                  <td key={i} className="border-b border-l border-line px-4 py-5">
                    <CellMark cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile: Hover column always shown, competitor picker below ── */}
      <div className="mt-10 md:hidden">
        <div className="rounded-lg border border-[rgba(124,255,168,0.35)] bg-[rgba(124,255,168,0.06)] p-5">
          <div className="mb-4 font-mono text-[14px] font-semibold text-mint">Hover</div>
          <ul className="space-y-3.5">
            {ROWS.map((r) => (
              <li key={r.dim} className="flex items-start gap-3">
                <span
                  className="mt-0.5 font-mono text-[14px] leading-none"
                  style={{ color: ICON[r.hover.v].color }}
                  aria-label={ICON[r.hover.v].label}
                >
                  {ICON[r.hover.v].glyph}
                </span>
                <div>
                  <div className="text-[13px] font-medium leading-snug text-text">{r.dim}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-text-dim">{r.hover.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-5">
          <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1">
            {COMPETITORS.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => setActive(i)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] transition-colors ${
                  active === i
                    ? 'border-line-2 bg-bg-2 text-text'
                    : 'border-line text-text-mute'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-line bg-bg-2 p-5">
            <div className="mb-4 text-[14px] font-medium text-text">{COMPETITORS[active]}</div>
            <ul className="space-y-3.5">
              {ROWS.map((r) => {
                const cell = r.cols[active];
                return (
                  <li key={r.dim} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 font-mono text-[14px] leading-none"
                      style={{ color: ICON[cell.v].color }}
                      aria-label={ICON[cell.v].label}
                    >
                      {ICON[cell.v].glyph}
                    </span>
                    <div>
                      <div className="text-[13px] font-medium leading-snug text-text">{r.dim}</div>
                      <div className="mt-0.5 text-[12px] leading-snug text-text-dim">{cell.note}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <p className="mt-8 max-w-3xl text-[12.5px] leading-relaxed text-text-dim">
        <span className="font-mono" style={{ color: 'var(--color-mint)' }}>✓</span> yes ·{' '}
        <span className="font-mono" style={{ color: 'var(--color-warn)' }}>◐</span> partial ·{' '}
        <span className="font-mono" style={{ color: 'var(--color-error)' }}>✕</span> no ·{' '}
        <span className="font-mono text-text-dim">–</span> not applicable. QA Wolf and
        Momentic do not publish public pricing; figures elsewhere online come from
        third-party aggregators, so we describe their model rather than quote a number.
      </p>

      <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-text-dim">
        On <span className="text-text-mute">&ldquo;Generated spec guards every step&rdquo;</span>,{' '}
        <span className="font-mono" style={{ color: 'var(--color-error)' }}>✕</span> means the tool
        leans on Playwright&rsquo;s runtime auto-wait instead of writing an explicit per-step
        visibility assertion into the saved code. It still waits at run time; the artifact just
        carries no guard of its own.
      </p>

      <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-text-dim">
        Fact-checked against each vendor&rsquo;s own docs (2026):{' '}
        {SOURCES.map((s, i) => (
          <span key={s.name}>
            <a
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="text-text-mute underline-offset-2 hover:text-text hover:underline"
            >
              {s.name}
            </a>
            {i < SOURCES.length - 1 ? ' · ' : ''}
          </span>
        ))}
        .
      </p>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
      <span className="h-1.5 w-1.5 rounded-full bg-mint" />
      {children}
    </div>
  );
}
