'use client';

import { useState } from 'react';

/* ── Honest competitive comparison ──────────────────────────────────────
 * Every cell here is sourced from the vendor's own docs/site as of 2026.
 * Two deliberate accuracy rules (do NOT "round up" against competitors):
 *   - QA Wolf / Momentic publish no public pricing — we say "managed
 *     contract" / "sales-call", never a fabricated number.
 *   - Stagehand & Midscene keep AI wired into the run; their cached/replay
 *     paths hit Playwright-first, so the artifact row is "partial", phrased
 *     as "AI self-heal stays wired in" — NOT "needs AI every run".
 * If you change a cell, re-verify against the source before shipping. */

type Cell = { v: 'yes' | 'no' | 'partial' | 'na'; note: string };

type Row = {
  dim: string;
  hover: Cell;
  cols: Cell[]; // Momentic, QA Wolf, Playwright codegen, Stagehand, Midscene
};

const COMPETITORS = ['Momentic', 'QA Wolf', 'Playwright codegen', 'Stagehand', 'Midscene'];

const yes = (note: string): Cell => ({ v: 'yes', note });
const no = (note: string): Cell => ({ v: 'no', note });
const partial = (note: string): Cell => ({ v: 'partial', note });
const na = (note: string): Cell => ({ v: 'na', note });

const ROWS: Row[] = [
  {
    dim: 'AI authors the test from intent',
    hover: yes('Agent explores the flow from one English sentence'),
    cols: [
      yes('AI-authored'),
      partial('AI-assisted, humans finalise'),
      no('Records literal clicks only — no exploration'),
      yes('AI act / observe'),
      yes('Vision-driven AI'),
    ],
  },
  {
    dim: 'Output is plain Playwright that runs in CI with NO AI',
    hover: yes('Standard @playwright/test .spec.ts, agent-free forever'),
    cols: [
      no('No code at all — AI interprets steps at runtime'),
      yes('Real Playwright code (written by their team)'),
      yes('.spec.ts, no AI by design'),
      partial('Stagehand script; cached replay runs Playwright-first, but AI self-heal stays wired in'),
      no('JS/YAML needs the Midscene + AI runtime (caching cuts calls, not the dependency)'),
    ],
  },
  {
    dim: 'Open source / self-hosted',
    hover: yes('Apache-2.0, runs entirely on your machine'),
    cols: [
      no('Closed vendor platform'),
      no('Managed service'),
      yes('Apache-2.0 (part of Playwright)'),
      yes('MIT, runs local'),
      yes('MIT, runs local'),
    ],
  },
  {
    dim: 'Bring-your-own AI (your CLI / model key)',
    hover: yes('Spawns the claude / codex CLI already on your PATH'),
    cols: [
      no('Vendor-hosted AI, MOMENTIC_API_KEY'),
      na('Vendor-run — you supply no model'),
      na('No AI involved'),
      yes('Your own LLM provider key'),
      yes('Your own model / key'),
    ],
  },
  {
    dim: 'Drives your real local dev server',
    hover: yes('Injects into your dev server, drives your debug Chrome over CDP'),
    cols: [
      partial('CLI runs in your CI but is tied to the hosted account'),
      partial('Their infra runs against your deployed env'),
      yes('Fully local'),
      yes('Local, or optional Browserbase cloud'),
      yes('Local (Chrome extension / Bridge Mode)'),
    ],
  },
  {
    dim: 'Pricing',
    hover: yes('Free / OSS — you pay only the CLI plan you already have'),
    cols: [
      no('Quote-based, sales-call'),
      no('Managed contract (no public pricing)'),
      yes('Free / OSS'),
      partial('OSS free; Browserbase cloud paid'),
      yes('Free / OSS (pay your own model)'),
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
        Every cell below is taken from each vendor&rsquo;s own docs as of 2026.
        Where a tool publishes no public pricing we say so rather than guess.
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
