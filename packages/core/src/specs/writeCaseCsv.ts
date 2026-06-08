/**
 * Save a completed Hover session as an Xray-compatible test case CSV
 * (one file per session, multi-row layout — one row per replayable step).
 *
 * Target: Atlassian Marketplace's #1 test management for Jira (Xray,
 * ~10M users, ~100M test cases / month). The same CSV imports cleanly
 * into Zephyr Scale and the original Jira issue importer with minor
 * column mapping, so this is the broadest single-format hand-off into
 * a team's test management.
 *
 * Schema (Xray Test Case Importer — multi-row layout):
 *
 *   Issue Id        unique grouping key, repeated on every row of the
 *                   same test case. We use the slug.
 *   Summary         the test case title; set on the FIRST row only.
 *   Test Type       "Manual" for everything Hover emits.
 *   Priority        "Medium" by default; PMs can edit post-import.
 *   Labels          space-separated; "hover" plus the user-supplied set.
 *   Action          one human-readable imperative per row. Reuses the
 *                   humanSteps helper that also feeds the .spec.ts JSDoc.
 *   Expected Result attached to the LAST row of the case. Carries
 *                   assertion hints if present, else the agent's
 *                   done-summary first sentence.
 *
 * The "Issue Id" column is what tells Xray's importer that consecutive
 * rows belong to the same test, even though only the first row has a
 * Summary. The "Test Type" column tells it to instantiate the Manual
 * Test issue type and use the Step / Expected Result fields.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillStep } from '../skills/writeSkill.js';
import { humanSteps } from './humanSteps.js';
import type { SpecAssertion } from './writeSpec.js';
import { slugify, firstSentence } from './text.js';

export class CaseCsvExistsError extends Error {
  constructor(public readonly slug: string, public readonly path: string) {
    super(`Test case CSV "${slug}" already exists at ${path}`);
    this.name = 'CaseCsvExistsError';
  }
}

export interface WriteCaseCsvOptions {
  devRoot: string;
  name: string;
  description?: string;
  steps: SkillStep[];
  assertions?: SpecAssertion[];
  /** Optional Jira project key prefix (e.g. "PROJ"). Goes into Labels so
   *  the importer can route the test cases without rewriting the CSV.
   *  Stripped of whitespace; if empty, no project label is added. */
  jiraProjectKey?: string;
  /** Free-form labels appended after the default "hover" label. Split
   *  on commas/whitespace and lowercased. */
  labels?: string;
  overwrite?: boolean;
}

export interface WriteCaseCsvResult { path: string; slug: string; }

export async function writeCaseCsv(opts: WriteCaseCsvOptions): Promise<WriteCaseCsvResult> {
  const slug = slugify(opts.name);
  if (!slug) throw new Error('case name must contain at least one alphanumeric character');
  if (!opts.steps.some(s => s.kind === 'step')) {
    throw new Error('case must contain at least one tool step to describe');
  }

  const dir = join(opts.devRoot, '__vibe_tests__');
  const path = join(dir, `${slug}.case.csv`);
  if (!opts.overwrite && existsSync(path)) {
    throw new CaseCsvExistsError(slug, path);
  }

  await mkdir(dir, { recursive: true });
  const csv = renderCsv(slug, opts);
  await writeFile(path, csv, 'utf-8');
  return { path, slug };
}

// ───────── helpers ─────────

function renderCsv(slug: string, opts: WriteCaseCsvOptions): string {
  const rows = buildRows(slug, opts);
  // CRLF row terminator — what Excel / Numbers / Xray's importer all
  // assume by default. Comma column delimiter, fields with commas or
  // newlines get wrapped in double-quotes (escaped by doubling).
  const header = ['Issue Id', 'Summary', 'Test Type', 'Priority', 'Labels', 'Action', 'Expected Result'];
  const lines = [header.map(escapeField).join(',')];
  for (const r of rows) lines.push(r.map(escapeField).join(','));
  return lines.join('\r\n') + '\r\n';
}

function buildRows(slug: string, opts: WriteCaseCsvOptions): string[][] {
  const actions = humanSteps(opts.steps);
  const summary = opts.description?.trim() || opts.name;
  const expectedTail = expectedFor(opts.assertions ?? [], opts.steps);
  const labels = buildLabels(opts.jiraProjectKey, opts.labels);

  // Multi-row layout: one row per Action. First row carries the
  // test-case-level fields (Summary, Test Type, Priority, Labels); the
  // rest carry only the Issue Id + Action so Xray groups them.
  if (actions.length === 0) {
    // Defensive — writeCaseCsv() already throws on no replayable steps,
    // but keep a single-row fallback so the file is still well-formed.
    return [[slug, summary, 'Manual', 'Medium', labels, '(no replayable steps were captured)', expectedTail]];
  }

  const rows: string[][] = [];
  actions.forEach((action, i) => {
    const isFirst = i === 0;
    const isLast = i === actions.length - 1;
    rows.push([
      slug,
      isFirst ? summary : '',
      isFirst ? 'Manual' : '',
      isFirst ? 'Medium' : '',
      isFirst ? labels : '',
      action,
      isLast ? expectedTail : '',
    ]);
  });
  return rows;
}

function expectedFor(assertions: SpecAssertion[], steps: SkillStep[]): string {
  if (assertions.length > 0) {
    return assertions.map(a => `• ${a.hint ?? a.code}`).join('\n');
  }
  const done = [...steps].reverse().find(s => s.kind === 'done');
  if (done?.summary) {
    return firstSentence(done.summary);
  }
  return '';
}

function buildLabels(jiraProjectKey: string | undefined, labels: string | undefined): string {
  const set = new Set<string>(['hover']);
  if (jiraProjectKey?.trim()) set.add(jiraProjectKey.trim().toLowerCase());
  if (labels?.trim()) {
    labels.split(/[\s,]+/).filter(Boolean).forEach(l => set.add(l.toLowerCase()));
  }
  // Xray and Jira both accept space-separated labels in a single cell.
  return [...set].join(' ');
}

/**
 * RFC 4180 escaping: any field containing a quote, comma, CR, or LF
 * gets wrapped in double-quotes; embedded quotes are doubled.
 */
function escapeField(value: string): string {
  if (value === '') return '';
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
