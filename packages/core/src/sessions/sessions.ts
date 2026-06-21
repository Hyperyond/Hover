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
import { runDir, conversationsDir } from '../specs/sidecar.js';

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
  /** `<sanitized-startedAt>-<rand>` — the runId, generated at run start; names
   *  the run folder `.hover/runs/<conversationId>/<id>/` and is the meta.json id. */
  id: string;
  /** The chat conversation this run belongs to — the folder it's grouped under,
   *  so deleting a conversation removes all its runs. */
  conversationId?: string;
  startedAt: string;
  endedAt: string;
  /** Real wall-clock of the agent run (endedAt − startedAt in ms). The bare
   *  timestamps can collapse to ~0 for an instant failure; this is explicit. */
  durationMs?: number;
  agent: string;
  model?: string;
  /** Active mode: null/absent = normal authoring, else 'api-test' / 'pentest'.
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

/** Unescape literal "\n" / "\r\n" / "\t" sequences (e.g. an agent double-escaped
 *  its newlines) into real whitespace so markdown renders properly. */
function deEsc(s: string): string {
  return s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '  ');
}

/** Defensive leak-guard, NOT a parse path. The agent is directed to emit a
 *  plain-markdown report (REPORTING_DIRECTIVE) — no JSON. A non-compliant agent
 *  that still wraps its report in a ```json block would otherwise leak raw JSON
 *  to the UI, so strip it: recover the `summary` field as prose when present
 *  (tolerating unescaped quotes by matching up to `","findings"`), else drop the
 *  block. Findings are NEVER extracted from JSON — they come only from the
 *  markdown `## Findings` section below. */
function stripJsonArtifact(summary: string): string {
  const block = summary.match(/```json\s*([\s\S]*?)```/i);
  if (!block) return summary;
  const sm = block[1].match(/"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"findings"/i);
  if (sm) return deEsc(sm[1].replace(/\\"/g, '"')).trim();
  return summary.replace(block[0], '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Markdown-forced: the agent emits a plain-markdown report (REPORTING_DIRECTIVE)
 *  — ONE outcome line, `- ` bullets, and an optional `## Findings` section with
 *  `- **severity** — text` items. Parse the summary + findings from that markdown
 *  only; a stray ```json block (a non-compliant agent) is stripped, never parsed
 *  for findings and never leaked. Pure + total — no Findings block yields none. */
export function parseFindings(summary: string): { summary: string; findings: SessionFinding[] } {
  const lines = stripJsonArtifact(summary).split('\n');
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

/** Write one session record as `<runDir>/meta.json`. The id (runId) + the
 *  conversation are decided by the caller at run start (so screenshots + report
 *  share the folder). NEVER throws; returns the path or an error string. */
export async function writeSessionRecord(
  devRoot: string,
  conversationId: string,
  runId: string,
  rec: Omit<SessionRecord, 'version' | 'id' | 'conversationId'>,
): Promise<{ path: string; id: string } | { error: string }> {
  try {
    const dir = runDir(devRoot, conversationId, runId);
    await mkdir(dir, { recursive: true });
    const record: SessionRecord = { version: SESSION_RECORD_VERSION, id: runId, conversationId, ...rec };
    const path = join(dir, 'meta.json');
    await writeFile(path, JSON.stringify(record, null, 2) + '\n', 'utf-8');
    return { path, id: runId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** List every run's meta.json across all conversations: `.hover/runs/<conv>/<run>/meta.json`.
 *  Best-effort; returns [] if no runs yet. */
export async function listSessionRecords(
  devRoot: string,
): Promise<{ path: string; rec: SessionRecord }[]> {
  const out: { path: string; rec: SessionRecord }[] = [];
  const root = conversationsDir(devRoot);
  let convs: string[];
  try {
    convs = await readdir(root);
  } catch {
    return out;
  }
  for (const conv of convs) {
    let runIds: string[];
    try {
      runIds = await readdir(join(root, conv));
    } catch {
      continue;
    }
    for (const rid of runIds) {
      const path = join(root, conv, rid, 'meta.json');
      try {
        out.push({ path, rec: JSON.parse(await readFile(path, 'utf-8')) as SessionRecord });
      } catch {
        /* not a run dir / unreadable — skip */
      }
    }
  }
  return out;
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
    const records = (await listSessionRecords(devRoot)).sort((a, b) =>
      String(b.rec.startedAt).localeCompare(String(a.rec.startedAt)),
    );
    for (const { path, rec } of records) {
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
