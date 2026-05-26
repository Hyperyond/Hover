// Module-level transform refs so the cache lookup in reader.ts is stable
// across calls. Inline arrow functions would create a new identity each
// call and never hit the cache.

export const jsonStringify = (raw: string): string => JSON.stringify(raw);

/**
 * Strip ESM `export` keywords from a source file so it concatenates cleanly
 * into the browser IIFE alongside client.js. Top-level `export function …`
 * / `export const …` declarations become plain declarations whose names are
 * then visible inside the IIFE's closure. Vitest still imports each file
 * via real ESM semantics for the unit tests — only the inline-script-bundle
 * path runs this transform.
 *
 * Used by both reducer.js and voice.js (see assets.ts).
 */
export const stripModuleExports = (raw: string): string =>
  raw
    .replace(/^\s*export\s+(function|const|let|var)\b/gm, '$1')
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '');
