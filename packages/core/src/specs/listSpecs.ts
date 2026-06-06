/**
 * List + parse Hover-generated Playwright specs under `<devRoot>/__vibe_tests__/`.
 *
 * Used by:
 *   - The widget's "Specs" overlay tab (server pushes a SpecSummary[] list).
 *   - The CLI's `hover re-record <spec>` subcommand (parses one spec for its
 *     `Original prompt:` JSDoc header).
 *
 * Hand-authored specs (no Hover JSDoc header) are listed but reported with
 * `originalPrompt: null` — the UI / CLI surfaces that "this spec can't be
 * re-recorded automatically; the natural-language intent isn't recorded."
 *
 * Shares the SpecSummary row shape the widget's Specs tab renders.
 */
import { readdir, readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { countOptimizableMarkers } from './writeSpec.js';
import { readSeeds, relevantSeeds } from './seeds.js';
import { optimizationSuggestion, type OptimizationSuggestion } from './optimizationSuggestion.js';
import type { SpecSidecar } from './sidecar.js';

export interface SpecSummary {
  /** Path-relative slug, e.g. `login-and-counter`. Identifies the spec. */
  slug: string;
  /** Absolute path to the .spec.ts file. */
  path: string;
  /** `Original prompt:` parsed from the JSDoc header. `null` for
   *  hand-authored specs that have no header — they list but can't be
   *  re-recorded automatically. */
  originalPrompt: string | null;
  /** First line of `Outcome:` from the JSDoc header, if present. */
  outcome: string | null;
  /** Number of `Steps:` lines parsed (informational only). */
  stepCount: number;
  /** File mtime in ms — used to show "saved 2 hours ago" in the UI. */
  mtimeMs: number;
  /** Whether a structured `.hover/<slug>.json` sidecar exists. The widget
   *  gates the optimization pass on this — without a captured session there's
   *  no observed feedback for the LLM to add assertions from. */
  hasSidecar: boolean;
  /** Count of `// hover:optimizable` markers the deterministic translator left
   *  — interactions it couldn't fully translate single-step. >0 is a strong
   *  signal to run the optimization pass (or add a seed). */
  optimizableCount: number;
  /** The default-off "review optimization?" nudge (F7/D10): suggested + reasons,
   *  derived from optimizable markers + relevant seeds. */
  optimization: OptimizationSuggestion;
}

export interface SpecHeader {
  /** Raw text of `Original prompt:` line, or null when absent. */
  originalPrompt: string | null;
  /** First line of `Outcome:`. */
  outcome: string | null;
  /** Step lines from the `Steps:` block, in order. */
  steps: string[];
  /** Lines from the `Expected:` block, in order. */
  expected: string[];
}

/**
 * Parse the JSDoc header that `writeSpec.ts` emits. Tolerant of:
 *   - Specs without any JSDoc (returns all-null).
 *   - Hand-edited specs where users reordered or trimmed sections.
 *   - Long prompts that wrap across lines (we take only the first line).
 */
export function parseSpecHeader(source: string): SpecHeader {
  // JSDoc block right after the @playwright/test import (or at file top).
  // We don't require it to be the very first JSDoc — there could be a
  // banner comment from a linter. We DO require it to appear before the
  // first `test(` / `test.describe(` so that long file footers can't
  // confuse the parser.
  const beforeFirstTest = source.split(/^\s*(?:test|test\.describe)\s*\(/m)[0] ?? source;
  const blockMatch = beforeFirstTest.match(/\/\*\*([\s\S]*?)\*\//);
  if (!blockMatch) {
    return { originalPrompt: null, outcome: null, steps: [], expected: [] };
  }
  const block = blockMatch[1];

  const originalPrompt = extractScalar(block, /^\s*\*\s*Original prompt:\s*(.+?)\s*$/m);
  const outcome = extractScalar(block, /^\s*\*\s*Outcome:\s*(.+?)\s*$/m);

  return {
    originalPrompt,
    outcome,
    steps: extractList(block, /^\s*\*\s*Steps:\s*$/m),
    expected: extractList(block, /^\s*\*\s*Expected:\s*$/m),
  };
}

function extractScalar(block: string, re: RegExp): string | null {
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Extract a JSDoc list-style block. Given a header regex matching "Steps:"
 * or "Expected:", read subsequent ` * <indented line>` lines until the next
 * top-level marker (blank ` *` line or another `Section:` header).
 */
function extractList(block: string, headerRe: RegExp): string[] {
  const match = block.match(headerRe);
  if (!match) return [];
  const start = (match.index ?? 0) + match[0].length;
  const tail = block.slice(start);
  const lines: string[] = [];
  for (const raw of tail.split('\n')) {
    // Stop at a blank JSDoc line (` *` only) or another `Section:` header.
    if (/^\s*\*\s*$/.test(raw)) break;
    if (/^\s*\*\s*\w[\w ]*:\s*$/.test(raw) || /^\s*\*\s*\w[\w ]*:\s/.test(raw)) break;
    const m = raw.match(/^\s*\*\s*(?:[•\-\*\d.]\s*)*(.+?)\s*$/);
    if (m && m[1]) lines.push(m[1]);
  }
  return lines;
}

/**
 * List every `*.spec.ts` file under `<devRoot>/__vibe_tests__/` with its
 * parsed header. Returns newest-first by mtime so the widget overlay shows
 * recently-saved specs at the top.
 */
export async function listSpecs(devRoot: string): Promise<SpecSummary[]> {
  const root = join(devRoot, '__vibe_tests__');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  // Seeds are devRoot-wide; read once and reuse for every spec's suggestion.
  const seeds = await readSeeds(devRoot);

  const summaries: SpecSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.spec.ts')) continue;
    const path = join(root, entry);
    let content: string;
    let mtimeMs = 0;
    try {
      content = await readFile(path, 'utf-8');
      const st = await stat(path);
      mtimeMs = st.mtimeMs;
    } catch {
      continue;
    }
    const header = parseSpecHeader(content);
    const slug = entry.replace(/\.spec\.ts$/, '');
    const sidecarPath = join(root, '.hover', `${slug}.json`);
    const hasSidecar = existsSync(sidecarPath);
    const optimizableCount = countOptimizableMarkers(content);

    // Which seeds could plausibly apply, from the sidecar's captured tools.
    let relevantSeedNames: string[] = [];
    if (hasSidecar && seeds.length > 0) {
      try {
        const sc = JSON.parse(await readFile(sidecarPath, 'utf-8')) as SpecSidecar;
        const tools = new Set(
          (sc.steps ?? []).filter(s => s.kind === 'step' && s.tool).map(s => s.tool as string),
        );
        relevantSeedNames = relevantSeeds(seeds, tools).map(s => s.name);
      } catch {
        /* malformed sidecar — treat as no relevant seeds */
      }
    }

    summaries.push({
      slug,
      path,
      originalPrompt: header.originalPrompt,
      outcome: header.outcome,
      stepCount: header.steps.length,
      mtimeMs,
      hasSidecar,
      optimizableCount,
      optimization: optimizationSuggestion({ hasSidecar, optimizableCount, relevantSeedNames }),
    });
  }
  summaries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return summaries;
}
