/**
 * Small text helpers for the spec emitter.
 *
 * Hoisted here so writeSpec's JSDoc header derives a slug and a one-sentence
 * "Expected" line through one shared implementation.
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
