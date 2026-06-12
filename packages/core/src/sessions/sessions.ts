/**
 * Session ledger — one summary JSON per completed agent run, appended under
 * `.hover/sessions/`. The local console (S3) reads these for run history +
 * spend; Hover Cloud sync (S4) uploads them as-is.
 *
 * Deliberately summary-only: full `SkillStep[]` lives in the spec sidecar for
 * saved sessions and is dropped for unsaved ones (persisting unsaved
 * transcripts is a privacy decision deferred to a future opt-in).
 *
 * Like the atlas, writes are best-effort: a ledger failure must never break a
 * run or a save.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hoverDir } from '../specs/sidecar.js';

export const SESSION_RECORD_VERSION = 1;

export interface SessionRecord {
  version: number;
  /** `<ISO-ts>-<rand>` — also the filename stem. */
  id: string;
  startedAt: string;
  endedAt: string;
  agent: string;
  model?: string;
  prompt: string;
  outcome: 'saved' | 'completed' | 'error' | 'aborted';
  /** Set when the session was crystallized into a spec. */
  specSlug?: string;
  turns?: number;
  costUsd?: number;
  stepCount: number;
}

export function sessionsDir(devRoot: string): string {
  return join(hoverDir(devRoot), 'sessions');
}

/** Write one session record. NEVER throws; returns the path or an error
 *  string for the caller to log. */
export async function writeSessionRecord(
  devRoot: string,
  rec: Omit<SessionRecord, 'version' | 'id'>,
): Promise<{ path: string; id: string } | { error: string }> {
  try {
    const dir = sessionsDir(devRoot);
    await mkdir(dir, { recursive: true });
    const id = `${rec.endedAt.replace(/[:.]/g, '-')}-${Math.random().toString(16).slice(2, 6)}`;
    const record: SessionRecord = { version: SESSION_RECORD_VERSION, id, ...rec };
    const path = join(dir, `${id}.json`);
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', 'utf-8');
    return { path, id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Mark the session that produced `promptText` as crystallized: find the most
 * recent record matching the prompt that has no `specSlug` yet, set
 * `outcome: 'saved'` + the slug. Save-as-spec arrives as a separate WS message
 * after the run record was already written, so this is a patch, keyed on the
 * prompt (the `user` seed step) — tolerant by design; a miss is a no-op.
 * NEVER throws.
 */
export async function markSessionSaved(
  devRoot: string,
  promptText: string,
  specSlug: string,
): Promise<void> {
  try {
    const dir = sessionsDir(devRoot);
    const entries = (await readdir(dir)).filter(e => e.endsWith('.json')).sort().reverse();
    for (const entry of entries) {
      const path = join(dir, entry);
      let rec: SessionRecord;
      try {
        rec = JSON.parse(await readFile(path, 'utf-8')) as SessionRecord;
      } catch {
        continue;
      }
      if (rec.specSlug || rec.prompt !== promptText) continue;
      rec.outcome = 'saved';
      rec.specSlug = specSlug;
      await writeFile(path, JSON.stringify(rec, null, 2) + '\n', 'utf-8');
      return;
    }
  } catch {
    /* no ledger yet / unreadable — fine */
  }
}
