/*
 * LLM-Wiki P1 — Lint: a deterministic health check over `.hover/` (the app's
 * living test wiki). It cross-checks the business map against the real spec
 * files and the run ledger and reports drift:
 *
 *   - deleted-spec       a covered line points at a *.spec.ts that no longer exists
 *   - regressed-coverage a covered line's spec last ran fail/flaky (→ candidate for heal)
 *   - orphan-spec        a *.spec.ts exists but no line references it (a gap in the map)
 *
 * These are the CHEAP, mechanical checks — no LLM, no network. The LLM-judged
 * half (contradictory memory rules, routes in code missing from the map) is the
 * agent's job, driven by the `/mcp__hover__lint` prompt on top of this result.
 *
 * Pure-ish: reads the FS, never writes; a missing map / bad JSON degrades to a
 * partial (or empty) result, never throws.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseBusinessMap } from './businessMap.js';

export type LintSeverity = 'error' | 'warn' | 'info';
export type LintKind = 'deleted-spec' | 'regressed-coverage' | 'orphan-spec';

export interface LintFinding {
  kind: LintKind;
  severity: LintSeverity;
  /** One-line human-readable finding. */
  message: string;
  /** The business line involved (map label), if any. */
  line?: string;
  /** The spec basename involved, if any. */
  spec?: string;
  /** A suggested next action for the agent (e.g. heal, map, remove the ref). */
  fix?: string;
}

export interface LintResult {
  /** No error/warn findings (info-only still counts as ok). */
  ok: boolean;
  hasMap: boolean;
  findings: LintFinding[];
  summary: { areas: number; lines: number; covered: number; specs: number };
}

type RunStatus = 'pass' | 'fail' | 'flaky';
const RUN_RANK: Record<RunStatus, number> = { pass: 0, flaky: 1, fail: 2 };

/** Parse a Playwright JSON report into { specBasename → worst status }. Mirrors
 *  the cockpit's parser; an unexpected shape yields no entries. */
export function parseRunStatuses(json: unknown): Record<string, RunStatus> {
  const out: Record<string, RunStatus> = {};
  const worse = (a: RunStatus | undefined, b: RunStatus): RunStatus =>
    !a ? b : RUN_RANK[b] > RUN_RANK[a] ? b : a;
  const visit = (suite: { file?: string; specs?: unknown[]; suites?: unknown[] }, inherited?: string): void => {
    const file = suite.file ?? inherited;
    for (const raw of suite.specs ?? []) {
      const spec = raw as { ok?: boolean; tests?: { status?: string }[]; file?: string };
      const key = (file ?? spec.file ?? 'unknown').split(/[\\/]/).pop() ?? 'unknown';
      let status: RunStatus = spec.ok ? 'pass' : 'fail';
      if (spec.ok && (spec.tests ?? []).some((t) => t.status === 'flaky')) status = 'flaky';
      out[key] = worse(out[key], status);
    }
    for (const child of suite.suites ?? []) visit(child as typeof suite, file);
  };
  if (json && typeof json === 'object') {
    for (const s of (json as { suites?: unknown[] }).suites ?? []) visit(s as Parameters<typeof visit>[0]);
  }
  return out;
}

/** Recursively collect *.spec.ts basenames under __vibe_tests__/. */
async function collectSpecs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return; // no __vibe_tests__ yet
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === 'pages' || e.name === '.hover' || e.name === 'node_modules') continue;
        await walk(p);
      } else if (/\.spec\.tsx?$/.test(e.name)) {
        out.push(e.name);
      }
    }
  };
  await walk(dir);
  return out;
}

/** Latest run status per spec basename, merged newest-wins across `.hover/runs/*.json`
 *  (filename is the ISO stamp → lexical sort is chronological). */
async function latestRunStatuses(runsDir: string): Promise<Record<string, RunStatus>> {
  let files: string[];
  try {
    files = (await readdir(runsDir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return {};
  }
  const merged: Record<string, RunStatus> = {};
  for (const f of files) {
    // later files overwrite earlier → the latest run wins per spec
    try {
      const json = JSON.parse(await readFile(join(runsDir, f), 'utf-8'));
      Object.assign(merged, parseRunStatuses(json));
    } catch {
      /* skip a bad run file */
    }
  }
  return merged;
}

export async function lintWiki(devRoot: string): Promise<LintResult> {
  const hoverDir = join(devRoot, '.hover');
  const vibeDir = join(devRoot, '__vibe_tests__');

  let md = '';
  try {
    md = await readFile(join(hoverDir, 'hover-map.md'), 'utf-8');
  } catch {
    /* no map yet */
  }
  const hasMap = md.trim().length > 0;
  const graph = parseBusinessMap(md);

  const specFiles = await collectSpecs(vibeDir);
  const specSet = new Set(specFiles);
  const runs = await latestRunStatuses(join(hoverDir, 'runs'));

  const findings: LintFinding[] = [];
  const lines = graph.nodes.filter((n) => n.kind === 'line');
  const referenced = new Set<string>();

  for (const line of lines) {
    if (line.spec) {
      referenced.add(line.spec);
      // deleted-spec: a line points at a spec file that isn't on disk.
      if (!specSet.has(line.spec)) {
        findings.push({
          kind: 'deleted-spec',
          severity: 'error',
          line: line.label,
          spec: line.spec,
          message: `"${line.label}" points at ${line.spec}, which no longer exists in __vibe_tests__/.`,
          fix: `Re-crystallize the flow, or drop the stale spec reference from .hover/hover-map.md.`,
        });
        continue; // no point checking its run status
      }
      // regressed-coverage: a covered line whose spec last ran fail/flaky.
      const run = runs[line.spec];
      if (line.status === 'covered' && (run === 'fail' || run === 'flaky')) {
        findings.push({
          kind: 'regressed-coverage',
          severity: 'warn',
          line: line.label,
          spec: line.spec,
          message: `"${line.label}" is marked covered but ${line.spec} last ran ${run}.`,
          fix: `Heal it: /mcp__hover__heal ${line.spec.replace(/\.spec\.tsx?$/, '')}`,
        });
      }
    }
  }

  // orphan-spec: a UI spec on disk that no business line references (a map gap).
  // API specs (*.api-test.spec.ts) are siblings of a line, not lines → skip.
  for (const spec of specFiles) {
    if (spec.endsWith('.api-test.spec.ts')) continue;
    if (!referenced.has(spec)) {
      findings.push({
        kind: 'orphan-spec',
        severity: 'info',
        spec,
        message: `${spec} exists but no line in the business map references it.`,
        fix: `Add its business line to .hover/hover-map.md (mark it [x] with the spec).`,
      });
    }
  }

  const ok = !findings.some((f) => f.severity === 'error' || f.severity === 'warn');
  return {
    ok,
    hasMap,
    findings,
    summary: { areas: graph.stats.areas, lines: graph.stats.lines, covered: graph.stats.covered, specs: specFiles.length },
  };
}
