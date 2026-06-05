/**
 * Knowledge layer (F5): the project's testing conventions, injected into the
 * agent's system prompt so the developer can steer *how it explores* — which
 * flows matter, where login lives, the preferred selector attribute.
 *
 * Read by the SERVICE (not the agent) from `<projectRoot>/.hover/conventions.md`
 * and folded into the system prompt — the agent never gains a file-read tool
 * (D2). This shapes exploration only; it does NOT change how the saved spec is
 * generated (that's the translator's job — D9).
 *
 * Capped to avoid prompt bloat, and injected on the FIRST turn only (it's
 * static, like cdpHint's rules) so it doesn't fragment the prompt cache.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Max characters of the conventions file folded into the prompt. */
export const CONVENTIONS_MAX_CHARS = 4000;

/**
 * Read `<projectRoot>/.hover/conventions.md` and return it wrapped as a
 * system-prompt block, or null when the file is absent or empty.
 */
export async function readConventions(
  projectRoot: string,
  maxChars = CONVENTIONS_MAX_CHARS,
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(join(projectRoot, '.hover', 'conventions.md'), 'utf-8');
  } catch {
    return null; // no conventions file — nothing to inject
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const body =
    trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}\n…(truncated)` : trimmed;

  return [
    `Project testing conventions — the developer's house rules for this app,`,
    `from .hover/conventions.md. Use them while EXPLORING (which flows matter,`,
    `where login lives, preferred selectors, test data). They guide exploration`,
    `only — they do not change how the saved spec is generated.`,
    ``,
    body,
  ].join('\n');
}
