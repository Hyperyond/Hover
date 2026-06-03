/**
 * Stage 2 of structured spec output: detect flows repeated across saved specs.
 *
 * Reads the `.hover/<slug>.json` sidecars (Stage 1), normalizes each captured
 * step to a **signature** that keeps structure (tool + target) and drops data
 * values, then reports the shared *prefix* across specs. This is read-only —
 * it surfaces "these N specs all start by logging in" to the widget / CLI. It
 * does NOT generate Page Objects; that is Stage 3 (F4), which consumes this.
 *
 * Why prefixes only (not arbitrary common subsequences): D5 — the dominant
 * real case is many specs sharing an entry flow (login / navigate-to-X), and
 * prefix detection is near-zero false positives and cheap. Arbitrary fragments
 * are a later iteration.
 *
 * Why signatures (not parsing generated code): the sidecar already holds the
 * structured `SpecStep[]`. Two sessions that both "click Sign in" produce the
 * same signature even though their typed values differ — value vs. structure
 * separation is mechanical (D4).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sidecarDir, type SpecSidecar } from './sidecar.js';
import { humanStep } from './humanSteps.js';
import type { SkillStep } from '../skills/writeSkill.js';

export interface SharedFlow {
  /** The shared signature prefix, one entry per step. */
  signatures: string[];
  /** Human-readable prose for each prefix step (from one representative spec),
   *  for display in the widget / CLI. */
  prose: string[];
  /** Slugs of the specs that share this prefix, sorted. */
  specs: string[];
  /** The representative spec's original steps for the shared prefix, fed to
   *  generatePageObject during Stage 3 extraction. */
  prefixSteps: SkillStep[];
}

export interface DetectOptions {
  /** Minimum number of specs that must share the prefix to report it.
   *  Default 2 (surface candidates early); Stage 3 extraction uses 3. */
  minSpecs?: number;
  /** Minimum prefix length (in steps) worth reporting. Default 2 — a single
   *  shared navigation is too weak to be a flow. */
  minLen?: number;
}

/**
 * Reduce one captured step to a signature string: the tool plus its structural
 * target, with data values stripped. Returns null for steps that aren't part
 * of a replayable flow (diagnostics, tab switches, waits) so they don't anchor
 * or break a prefix.
 */
export function stepSignature(tool: string, rawInput: unknown): string | null {
  const i = (rawInput ?? {}) as Record<string, unknown>;
  switch (tool) {
    case 'browser_navigate':
      return `navigate:${stripPath(String(i.url ?? ''))}`;
    case 'browser_click':
      return `click:${normElement(i.element)}`;
    case 'browser_double_click':
      return `dblclick:${normElement(i.element)}`;
    case 'browser_hover':
      return `hover:${normElement(i.element)}`;
    case 'browser_type':
      // The typed text is data — only the target field is structure.
      return `type:${normElement(i.element)}`;
    case 'browser_select_option':
      return `select:${normElement(i.element)}`;
    case 'browser_fill_form': {
      // Field names are structure; their values are data. Sort so field order
      // doesn't change the signature.
      const fields = (i.fields as Array<Record<string, unknown>> | undefined) ?? [];
      const names = fields
        .map(f => normElement(f.name ?? f.element))
        .filter(Boolean)
        .sort();
      return `fill:${names.join(',')}`;
    }
    case 'browser_press_key':
      return `press:${String(i.key ?? '')}`;
    default:
      // Diagnostics / browser_tabs / browser_wait_for — not flow structure.
      return null;
  }
}

/** Read and parse every sidecar under `.hover/`. Malformed files are skipped
 *  (better to detect across the valid ones than fail because one is broken). */
async function readSidecars(devRoot: string): Promise<SpecSidecar[]> {
  const dir = sidecarDir(devRoot);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: SpecSidecar[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const sc = JSON.parse(await readFile(join(dir, entry), 'utf-8')) as SpecSidecar;
      if (Array.isArray(sc.steps) && typeof sc.slug === 'string') out.push(sc);
    } catch {
      // skip malformed sidecar
    }
  }
  return out;
}

/** Project a sidecar's steps to (signature, prose) lists, dropping
 *  non-flow steps. */
function signatureSeq(
  sc: SpecSidecar,
): { slug: string; sigs: string[]; prose: string[]; steps: SkillStep[] } {
  const sigs: string[] = [];
  const prose: string[] = [];
  const steps: SkillStep[] = [];
  for (const s of sc.steps) {
    if (s.kind !== 'step' || !s.tool) continue;
    const sig = stepSignature(s.tool, s.input);
    if (sig == null) continue;
    sigs.push(sig);
    prose.push(humanStep(s.tool, s.input) ?? s.tool);
    steps.push(s);
  }
  return { slug: sc.slug, sigs, prose, steps };
}

function longestCommonPrefixLen(seqs: string[][]): number {
  if (seqs.length === 0) return 0;
  const minL = Math.min(...seqs.map(s => s.length));
  let i = 0;
  for (; i < minL; i++) {
    const v = seqs[0][i];
    if (!seqs.every(s => s[i] === v)) break;
  }
  return i;
}

/**
 * Detect flows shared as a common prefix across saved specs. Groups specs by
 * their first step's signature (the entry move), then reports each group's
 * longest common prefix that ≥ minSpecs specs share and is ≥ minLen steps long.
 */
export async function detectSharedFlows(
  devRoot: string,
  opts: DetectOptions = {},
): Promise<SharedFlow[]> {
  const minSpecs = opts.minSpecs ?? 2;
  const minLen = opts.minLen ?? 2;

  const seqs = (await readSidecars(devRoot))
    .map(signatureSeq)
    .filter(s => s.sigs.length > 0);

  // Group by first signature — the dominant case is many specs that all start
  // with the same entry flow (login / navigate-to-X).
  const groups = new Map<string, typeof seqs>();
  for (const s of seqs) {
    const key = s.sigs[0];
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const flows: SharedFlow[] = [];
  for (const group of groups.values()) {
    if (group.length < minSpecs) continue;
    const lcp = longestCommonPrefixLen(group.map(g => g.sigs));
    if (lcp < minLen) continue;
    flows.push({
      signatures: group[0].sigs.slice(0, lcp),
      prose: group[0].prose.slice(0, lcp),
      specs: group.map(g => g.slug).sort(),
      prefixSteps: group[0].steps.slice(0, lcp),
    });
  }
  // Longest shared prefix first — the richest extraction candidate on top.
  flows.sort((a, b) => b.signatures.length - a.signatures.length);
  return flows;
}

function normElement(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function stripPath(url: string): string {
  if (!/^https?:\/\//.test(url)) return url;
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}
