/**
 * QA report artifact — the durable, human-readable output of a QA Testing run.
 *
 * QA is report-first: a run produces findings (rendered live in the chat's
 * Findings card via the normal parseFindings pipeline) AND this persistent
 * Markdown report under `<devRoot>/.hover/qa-reports/<slug>.md`, mirroring
 * pentest's report file. Latest-run-wins per prompt slug (the session ledger
 * keeps the full history; this is the readable artifact).
 *
 * Best-effort by contract: a report-write failure must NEVER break a run or the
 * ledger (same rule as the session ledger + business memory).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionFinding } from '../sessions/sessions.js';

export interface QaReportInput {
  prompt: string;
  summary: string;
  findings: SessionFinding[];
  endedAt: string;
  targetUrl?: string;
}

/** Render the report Markdown (pure — exported for testing). */
export function renderQaReport(input: QaReportInput): string {
  const { prompt, summary, findings, endedAt, targetUrl } = input;
  const meta = [endedAt, targetUrl, `${findings.length} finding${findings.length === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');
  const body = [`# QA report — ${prompt.trim()}`, '', `_${meta}_`];
  if (summary.trim()) body.push('', summary.trim());
  body.push('', '## Findings');
  if (findings.length) {
    for (const f of findings) {
      const sev = (f.severity || 'note').trim();
      const head = f.title && f.title !== f.text ? `${f.title} — ` : '';
      body.push(`- **${sev}** — ${head}${f.text.trim()}`);
    }
  } else {
    body.push('_No issues found._');
  }
  return body.join('\n') + '\n';
}

/** Write the QA report into the run's folder as `report.md`. Each run (incl.
 *  each phase of a two-pass run) has its own folder, so there's no name
 *  collision. NEVER throws; returns the path or an error string. */
export async function writeQaReport(
  runDirPath: string,
  input: QaReportInput,
): Promise<{ path: string } | { error: string }> {
  try {
    await mkdir(runDirPath, { recursive: true });
    const path = join(runDirPath, 'report.md');
    await writeFile(path, renderQaReport(input), 'utf-8');
    return { path };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
