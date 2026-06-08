/**
 * Small text helpers shared across the spec/CSV emitters.
 *
 * Hoisted here so the two crystallization outputs (writeSpec's JSDoc header and
 * writeCaseCsv's Xray rows) derive a slug and a one-sentence "Expected" line the
 * same way — they used to carry byte-identical copies of this logic.
 */

/** Lowercase, hyphenate, and trim a display name into a filesystem-safe slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The first sentence of a done-summary, trimmed. Agents sometimes ramble; the
 * Expected blocks only want the leading sentence. Splits on the gap that
 * follows sentence-ending punctuation (`.`, `!`, `?`); a summary with no such
 * punctuation comes back trimmed in full.
 */
export function firstSentence(summary: string): string {
  return summary.split(/(?<=[.!?])\s+/)[0]?.trim() ?? summary.trim();
}
