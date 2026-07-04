/**
 * Business memory — the per-app knowledge QA / API modes accumulate so they stop
 * re-asking the same business questions every run. Lives at `<devRoot>/.hover/
 * memory/`, mirroring Claude's own memory layout (an index + one fact per file):
 *
 *   .hover/memory/
 *     MEMORY.md        ← index: one `- [title](file.md) — hook` line per fact
 *     checkout-tax.md  ← frontmatter (name / description / type) + the fact body
 *     ...
 *
 * Loop: load at run start → inject as agent context ("Known business rules…");
 * after the user answers a business clarification (trigger-B, a later QA stage),
 * write the learned fact. The more an app is tested, the fewer popups — see the
 * QA-tester-mode design + project-moat-strategy.
 *
 * CONTRACT: business RULES only, NEVER secrets / PII / credentials (extends the
 * standing "never read env / secrets" rule). Writes are best-effort — a memory
 * failure must NEVER break a run (same rule as the session ledger). Used by QA +
 * API modes only; Flow / Pentest don't read or write it.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hoverDir } from '../specs/sidecar.js';
import { ensureKnowledgeTracked } from './gitignore.js';

/** A learned business fact about the app under test. */
export interface BusinessFact {
  /** kebab-case slug; also the filename stem. */
  name: string;
  /** One-line summary used for recall relevance + the index hook. */
  description: string;
  /** What kind of knowledge this is. */
  type: 'business-rule' | 'expected-behavior' | 'validation' | 'access-policy';
  /**
   * The business line this rule governs, as named in `.hover/hover-map.md`
   * (optional). Anchors the rule to a node in the business map so a map view
   * can show "this line's rules" and a heal can weigh a recent rule change
   * against a failure. App-wide rules leave it blank.
   */
  line?: string;
  /** The fact itself (markdown). */
  body: string;
}

export function memoryDir(devRoot: string): string {
  return join(hoverDir(devRoot), 'memory');
}

/** kebab-case a title into a safe filename stem. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'fact';
}

/** Parse a fact file's `---` frontmatter + body. Minimal + total — a malformed
 *  file yields nulls and is skipped by the caller. Only the three known keys are
 *  read; everything after the closing `---` is the body. */
function parseFact(slug: string, raw: string): BusinessFact | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1];
  const body = m[2].trim();
  const field = (k: string): string => {
    const f = fm.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, 'm'));
    return f ? f[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  const description = field('description');
  const rawType = field('type');
  const types = ['business-rule', 'expected-behavior', 'validation', 'access-policy'] as const;
  const type = (types as readonly string[]).includes(rawType) ? (rawType as BusinessFact['type']) : 'business-rule';
  const line = field('line');
  if (!body) return null;
  return { name: field('name') || slug, description, type, ...(line ? { line } : {}), body };
}

/** Load every fact under `.hover/memory/` (excluding the MEMORY.md index).
 *  Pure + total: a missing dir / unreadable file just yields fewer facts. */
export async function loadMemory(devRoot: string): Promise<BusinessFact[]> {
  try {
    const dir = memoryDir(devRoot);
    const entries = (await readdir(dir)).filter((e) => e.endsWith('.md') && e.toLowerCase() !== 'memory.md');
    const facts: BusinessFact[] = [];
    for (const entry of entries.sort()) {
      try {
        const raw = await readFile(join(dir, entry), 'utf-8');
        const fact = parseFact(entry.replace(/\.md$/, ''), raw);
        if (fact) facts.push(fact);
      } catch {
        /* skip unreadable */
      }
    }
    return facts;
  } catch {
    return [];
  }
}

/** Format loaded facts as a system-prompt block, or '' when there are none (so
 *  the caller appends nothing). Grouped nothing-fancy: one bullet per fact. */
export function formatMemoryForPrompt(facts: BusinessFact[]): string {
  if (!facts.length) return '';
  const lines = facts.map((f) => `- ${f.description ? f.description + ' — ' : ''}${f.body.replace(/\s+/g, ' ').trim()}`);
  return (
    'KNOWN BUSINESS KNOWLEDGE FOR THIS APP (learned from earlier runs — treat as ' +
    'ground truth; do NOT re-ask what these already answer):\n' +
    lines.join('\n')
  );
}

/** Above this many chars of formatted-full memory, recall returns the INDEX
 *  (title — description per rule) instead of every rule's body, and the agent
 *  pulls a specific rule with `recall_fact` on demand — Claude-Code-style
 *  progressive disclosure. Below it, inlining everything is cheaper than making
 *  the agent round-trip for five rules, so recall stays full. */
export const RECALL_INLINE_BUDGET = 2000;

/** The INDEX block: one `title — description (type)` line per rule, no bodies.
 *  This is the always-cheap tier; a rule's body is fetched by `readFact`. */
export function formatMemoryIndex(facts: BusinessFact[]): string {
  if (!facts.length) return '';
  const lines = facts.map(
    (f) => `- ${f.name}${f.description ? ` — ${f.description}` : ''} (${f.type})`,
  );
  return (
    `KNOWN BUSINESS KNOWLEDGE FOR THIS APP — ${facts.length} rules learned from earlier ` +
    `runs (treat as ground truth; do NOT re-ask what these answer). This is the INDEX; ` +
    `call recall_fact("<name>") to read a rule's full text when it's relevant to what ` +
    `you're testing:\n` +
    lines.join('\n')
  );
}

/** Recall memory with progressive disclosure: full bodies when the set is small
 *  (≤ RECALL_INLINE_BUDGET chars formatted), the index alone when it's large.
 *  '' when there are no facts. This is what `recall_business_knowledge` returns. */
export async function recallMemory(devRoot: string): Promise<string> {
  const facts = await loadMemory(devRoot);
  if (!facts.length) return '';
  const full = formatMemoryForPrompt(facts);
  return full.length <= RECALL_INLINE_BUDGET ? full : formatMemoryIndex(facts);
}

/** Format one fact's FULL text (body verbatim, not whitespace-collapsed) for an
 *  on-demand `recall_fact`. */
export function formatFact(fact: BusinessFact): string {
  return `${fact.name}${fact.description ? ` — ${fact.description}` : ''} (${fact.type}):\n${fact.body.trim()}`;
}

/** Load ONE fact by name/slug for on-demand recall. Match order: exact slug →
 *  slugified-name equality → prefix → substring. Returns null if nothing matches
 *  (or the memory dir is empty). Total: never throws. */
export async function readFact(devRoot: string, name: string): Promise<BusinessFact | null> {
  const facts = await loadMemory(devRoot);
  if (!facts.length) return null;
  const q = slugify(name);
  return (
    facts.find((f) => f.name === q) ??
    facts.find((f) => slugify(f.name) === q) ??
    facts.find((f) => f.name.startsWith(q) || slugify(f.name).startsWith(q)) ??
    facts.find((f) => f.name.includes(q) || slugify(f.name).includes(q)) ??
    null
  );
}

/** Write (or overwrite) a fact file + refresh the MEMORY.md index line. NEVER
 *  throws — returns the path or an error string for the caller to log. Business
 *  RULES only; the caller must never pass secrets / PII / credentials. */
export async function writeFact(
  devRoot: string,
  fact: BusinessFact,
): Promise<{ path: string } | { error: string }> {
  try {
    const dir = memoryDir(devRoot);
    await mkdir(dir, { recursive: true });
    const slug = slugify(fact.name);
    const file = `${slug}.md`;
    const lineField = fact.line?.trim() ? `line: ${fact.line.trim()}\n` : '';
    const content =
      `---\nname: ${slug}\ndescription: ${fact.description}\ntype: ${fact.type}\n${lineField}---\n\n${fact.body.trim()}\n`;
    await writeFile(join(dir, file), content, 'utf-8');
    await upsertIndex(dir, slug, fact);
    // Best-effort: make sure the committed knowledge is actually trackable in
    // git (memory dir, map, log). Never lets a gitignore hiccup fail the write.
    await ensureKnowledgeTracked(devRoot);
    return { path: join(dir, file) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Add/replace this fact's line in MEMORY.md (`- [title](file.md) — hook`),
 *  keyed by the file link so re-writing a fact updates rather than duplicates. */
async function upsertIndex(dir: string, slug: string, fact: BusinessFact): Promise<void> {
  const indexPath = join(dir, 'MEMORY.md');
  const link = `(${slug}.md)`;
  const line = `- [${fact.name}](${slug}.md) — ${fact.description || fact.type}`;
  let existing = '';
  try {
    existing = await readFile(indexPath, 'utf-8');
  } catch {
    existing = '# Business memory\n\nWhat Hover has learned about this app. One fact per file.\n';
  }
  const kept = existing
    .split('\n')
    .filter((l) => !(l.startsWith('- [') && l.includes(link)));
  await writeFile(indexPath, `${kept.join('\n').replace(/\n+$/, '')}\n${line}\n`, 'utf-8');
}
