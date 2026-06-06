/**
 * Community translation seeds (Stage 6, approach A): human-written worked
 * examples that teach the optimization pass (F7) new patterns by few-shot,
 * NOT by deterministic match+template. A seed is a rough `signature` (tool
 * names, used only to pick relevant seeds) + a concrete `example`
 * (input steps → output code) the LLM generalizes from.
 *
 * Sources: a small built-in set + the project's <projectRoot>/.hover/rules/.
 * Adding a pattern = dropping an example JSON in .hover/rules/ — no core change.
 *
 * Built-in seeds deliberately cover patterns the deterministic translator does
 * NOT hardcode (popup is already hardcoded in writeSpec, so it's not here).
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface SeedRule {
  /** Identifier, e.g. `download`. */
  name: string;
  /** Rough match signature — tool names (optionally `tool:detail`), used only
   *  to pick relevant seeds for a spec, NOT for exact matching. */
  signature: string[];
  /** One-line human note: what the pattern is / when it applies. */
  note?: string;
  /** A concrete worked example the LLM generalizes from. */
  example: { steps: unknown[]; code: string };
}

/**
 * Built-in seeds ship with core and feed EVERY project's optimization pass, so
 * the bar is high: a pattern qualifies as built-in ONLY if it's a *highly
 * certain* optimization — a fixed, app-agnostic translation whose output is
 * deterministic and can't mislead (e.g. download → waitForEvent pairing).
 *
 * Deliberately NOT built-in:
 *   - Semantic / judgement-based optimizations (e.g. WHICH feedback text to
 *     assert) — those are already standing instructions in buildOptimizePrompt,
 *     and a bad generalization would pollute every user's spec.
 *   - Popup/new-tab — hardcoded in the translator (writeSpec), not a seed.
 * Project-specific or speculative patterns live in <root>/.hover/rules/, where
 * the bar is the user's own call.
 */
export const BUILTIN_SEEDS: SeedRule[] = [
  {
    name: 'download',
    signature: ['browser_click'],
    note: 'a click that triggers a file download → pair with waitForEvent("download")',
    example: {
      steps: [{ tool: 'browser_click', element: 'Export CSV button' }],
      code:
        "const [download] = await Promise.all([\n" +
        "  page.waitForEvent('download'),\n" +
        "  page.getByRole('button', { name: 'Export CSV' }).click(),\n" +
        "]);\n" +
        "expect(await download.suggestedFilename()).toContain('.csv');",
    },
  },
];

/** Built-in seeds + any in <projectRoot>/.hover/rules/*.json. Malformed files
 *  are skipped rather than failing the whole read. */
export async function readSeeds(projectRoot: string): Promise<SeedRule[]> {
  const out: SeedRule[] = [...BUILTIN_SEEDS];
  try {
    const dir = join(projectRoot, '.hover', 'rules');
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(await readFile(join(dir, f), 'utf-8')) as SeedRule;
        if (s && s.name && Array.isArray(s.signature) && s.example?.code) out.push(s);
      } catch {
        /* skip malformed seed file */
      }
    }
  } catch {
    /* no .hover/rules/ directory */
  }
  return out;
}

/** Pick seeds whose signature's base tool appears in the spec — a cheap
 *  relevance filter so the prompt only carries plausibly-applicable examples. */
export function relevantSeeds(seeds: SeedRule[], specTools: Set<string>, cap = 6): SeedRule[] {
  const hits = seeds.filter(s => s.signature.some(sig => specTools.has(sig.split(':')[0])));
  return hits.slice(0, cap);
}
