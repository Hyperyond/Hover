/**
 * Session ledger — one summary JSON per completed agent run, appended under
 * `.hover/sessions/`. The local console (S3) reads these for run history +
 * spend; Hover Cloud sync (S4) uploads them as-is.
 *
 * Deliberately summary-only: full `SkillStep[]` lives in the spec sidecar for
 * saved sessions and is dropped for unsaved ones (persisting unsaved
 * transcripts is a privacy decision deferred to a future opt-in).
 *
 * Writes are best-effort: a ledger failure must never break a run or a save.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hoverDir } from '../specs/sidecar.js';

export const SESSION_RECORD_VERSION = 2;

/** One agent-reported finding (the ## Findings block), persisted so the
 *  ledger becomes a reusable findings log — not just a run-history list.
 *  Severity is the raw marker the agent emitted (Bug / Minor / Info / …);
 *  readers normalise it for display. */
export interface SessionFinding {
  severity: string;
  text: string;
  /** Optional short headline (from the structured JSON findings block). */
  title?: string;
  /** Endpoint / method when the finding is about an API call — used to
   *  crystallize a request-based regression later. */
  endpoint?: string;
  method?: string;
}

export interface SessionRecord {
  /** Bumped to 2 when the reproducibility + outcome fields below were added.
   *  Readers must tolerate v1 records (every new field is optional). */
  version: number;
  /** `<ISO-ts>-<rand>` — also the filename stem. */
  id: string;
  startedAt: string;
  endedAt: string;
  /** Real wall-clock of the agent run (endedAt − startedAt in ms). The bare
   *  timestamps can collapse to ~0 for an instant failure; this is explicit. */
  durationMs?: number;
  agent: string;
  model?: string;
  /** Active mode: null/absent = normal authoring, else 'security' / 'pentest'.
   *  A pentest record is a different artifact from a normal one. */
  mode?: string | null;
  prompt: string;
  outcome: 'saved' | 'completed' | 'error' | 'aborted';
  /** Why an error/aborted run ended — engine message, preflight failure,
   *  budget cutoff, user cancel. Makes a failed record diagnostic. */
  errorReason?: string;
  /** The agent's final verification prose (the Result card body), minus the
   *  Findings block. Searchable history + context, not just the prompt. */
  summary?: string;
  /** Parsed ## Findings — the run's actual product output. */
  findings?: SessionFinding[];
  /** Per-tool call counts (browser_snapshot → 12, browser_click → 8). Explains
   *  cost and feeds optimization targeting. */
  toolCounts?: Record<string, number>;
  /** What this run drove. envId/envName come from the editor's environment
   *  store (Local vs a remote target); url is the active dev tab. The Cloud
   *  run layer keys flakiness + scheduling off these. */
  target?: { url?: string; envId?: string; envName?: string };
  /** @account labels this run logged in with — LABELS ONLY, never the
   *  username/password (same contract as spec redaction). */
  accountLabels?: string[];
  /** Tag of the `.hover/screenshots/<tag>` dir this run wrote to, so the UI
   *  can open the run's artifacts. (Distinct from `id` because the screenshot
   *  dir is named at MCP-launch time, before the record id exists.) */
  screenshotTag?: string;
  /** Chaining hook (reserved for Cloud): the prior turn's session id when this
   *  was a `--resume` follow-up, so a multi-turn conversation links as one. */
  resumeOf?: string;
  /** Set when the session was crystallized into a spec. */
  specSlug?: string;
  turns?: number;
  costUsd?: number;
  /** Total tokens consumed (input + output + cache) — the raw-usage counterpart
   *  to costUsd, surfaced by the widget/dashboard for users who track tokens
   *  rather than dollars. */
  tokensUsed?: number;
  stepCount: number;
}

/** Parse the agent's final summary into prose + structured findings, mirroring
 *  the chat webview's splitter so the ledger and the UI agree on what counts
 *  as a finding. Returns the summary with the Findings block stripped, plus the
 *  parsed bullets. Pure + total — a malformed summary just yields no findings. */
/** Extract + parse the agent's fenced ```json findings block, if present + valid.
 *  Returns null when there's no usable block (caller falls back to markdown). */
function parseStructuredFindings(
  summary: string,
): { summary: string; findings: SessionFinding[] } | null {
  // The block is at the end of the report; scan all ```json fences, take the
  // last one that parses into an object with a findings array.
  const re = /```json\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  let last: { raw: string; obj: { summary?: unknown; findings?: unknown } } | null = null;
  while ((m = re.exec(summary)) !== null) {
    try {
      const obj = JSON.parse(m[1].trim()) as { summary?: unknown; findings?: unknown };
      if (obj && typeof obj === 'object' && Array.isArray(obj.findings)) last = { raw: m[0], obj };
    } catch {
      /* not this block */
    }
  }
  if (!last) return null;
  const findings: SessionFinding[] = [];
  for (const f of last.obj.findings as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object') continue;
    const title = typeof f.title === 'string' ? f.title.trim() : undefined;
    const detail = typeof f.detail === 'string' ? f.detail.trim() : typeof f.text === 'string' ? f.text.trim() : '';
    const text = detail || title || '';
    if (!text) continue;
    findings.push({
      severity: typeof f.severity === 'string' && f.severity.trim() ? f.severity.trim() : 'note',
      text,
      title: title && title !== text ? title : undefined,
      endpoint: typeof f.endpoint === 'string' ? f.endpoint : undefined,
      method: typeof f.method === 'string' ? f.method : undefined,
    });
  }
  // Human summary = the explicit `summary` field, else the report with the JSON
  // block stripped out.
  const clean =
    typeof last.obj.summary === 'string' && last.obj.summary.trim()
      ? last.obj.summary.trim()
      : summary.replace(last.raw, '').replace(/\n{3,}/g, '\n\n').trim();
  return { summary: clean, findings };
}

/** Structured-first: the agent ends its report with a fenced ```json block
 *  { summary, findings: [{severity, title, detail, endpoint?, method?}] }. Parse
 *  that (robust, no prose-scraping); fall back to the markdown heading scan only
 *  when there's no valid block (older / non-compliant runs). */
export function parseFindings(summary: string): { summary: string; findings: SessionFinding[] } {
  const struct = parseStructuredFindings(summary);
  if (struct) return struct;
  const lines = summary.split('\n');
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^#{1,6}\s*(findings|bugs|issues)\b/i.test(t) || /^findings\s*:/i.test(t)) { hi = i; break; }
  }
  if (hi < 0) return { summary: summary.trim(), findings: [] };
  let j = hi + 1;
  while (j < lines.length && lines[j].trim() === '') j++;
  const start = j;
  while (j < lines.length && /^\s*[-*]\s+/.test(lines[j])) j++;
  const bullets = lines.slice(start, j);
  const findings: SessionFinding[] = [];
  for (const line of bullets) {
    const m = line.match(/^\s*[-*]\s+(?:\*\*\s*([^*]+?)\s*\*\*\s*[—–:-]?\s*)?([\s\S]+)$/);
    if (!m) continue;
    const text = (m[2] || '').trim();
    if (!text) continue;
    findings.push({ severity: (m[1] || 'note').trim(), text });
  }
  const main = lines.slice(0, hi).concat(lines.slice(j)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { summary: main, findings };
}

/** Count tool_use steps by tool name for the `toolCounts` field. */
export function tallyTools(steps: { kind: string; tool?: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of steps) {
    if (s.kind !== 'step' || !s.tool) continue;
    counts[s.tool] = (counts[s.tool] ?? 0) + 1;
  }
  return counts;
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
