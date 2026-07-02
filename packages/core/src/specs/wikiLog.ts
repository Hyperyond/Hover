/*
 * LLM-Wiki P3 — `.hover/log.md`: an append-only, machine-parseable run history
 * for the app's test wiki. One event per line:
 *
 *   - <ISO timestamp> · <kind> · <summary>
 *
 * Hover writes it deterministically as it MUTATES the wiki (a spec crystallized,
 * an API spec locked, Page Objects extracted) — no dependence on the agent
 * remembering to log, and no prompt churn. It powers an auditable timeline (and
 * a future cockpit history view). Best-effort by contract: a log failure must
 * NEVER break a crystallize / extract — same rule as the memory + run ledger.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hoverDir } from './sidecar.js';

export type WikiLogKind = 'crystallize' | 'api' | 'extract' | 'heal' | 'note';

export interface WikiLogEntry {
  /** ISO-8601 timestamp. */
  iso: string;
  kind: string;
  summary: string;
}

const HEADER =
  '# Hover log\n\n' +
  "Append-only run history for this app's test wiki. One event per line: " +
  '`- <ISO> · <kind> · <summary>`.\n\n';

export function wikiLogPath(devRoot: string): string {
  return join(hoverDir(devRoot), 'log.md');
}

/** Append one event line. Best-effort — never throws. */
export async function appendWikiLog(devRoot: string, kind: WikiLogKind, summary: string): Promise<void> {
  try {
    await mkdir(hoverDir(devRoot), { recursive: true });
    const path = wikiLogPath(devRoot);
    let existing = '';
    try {
      existing = await readFile(path, 'utf-8');
    } catch {
      /* new file → write the header first */
    }
    const iso = new Date().toISOString();
    const line = `- ${iso} · ${kind} · ${summary.replace(/\s+/g, ' ').trim()}\n`;
    await appendFile(path, `${existing ? '' : HEADER}${line}`, 'utf-8');
  } catch {
    /* best-effort: a wiki-log failure must not break the write that triggered it */
  }
}

/** Read the log's most recent entries (oldest→newest), parsed. Total: a missing
 *  or malformed file yields []. */
export async function readWikiLog(devRoot: string, limit = 200): Promise<WikiLogEntry[]> {
  try {
    const raw = await readFile(wikiLogPath(devRoot), 'utf-8');
    const entries: WikiLogEntry[] = [];
    for (const l of raw.split('\n')) {
      const m = l.match(/^-\s+(\S+)\s+·\s+(\w+)\s+·\s+(.+)$/);
      if (m) entries.push({ iso: m[1], kind: m[2], summary: m[3].trim() });
    }
    return entries.slice(-limit);
  } catch {
    return [];
  }
}
