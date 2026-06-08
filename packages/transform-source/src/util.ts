import path from 'node:path';

/** Compute 1-indexed line + 1-indexed column for a byte offset into `code`.
 *  Single-sourced so every framework transform speaks the same coordinate
 *  language: Vue / Svelte (which pass a `<`-relative offset here) and JSX
 *  (which reports `loc.start.column + 1`) all emit 1-indexed line + col,
 *  matching how editors show "Ln 3, Col 12". Returns `null` for an
 *  out-of-range offset. */
export function lineColForOffset(
  code: string,
  offset: number,
): { line: number; col: number } | null {
  if (offset < 0 || offset > code.length) return null;
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset; i++) {
    if (code.charCodeAt(i) === 10) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/** Compute the project-relative path stamped into `data-hover-source`.
 *  Normalises the OS path separator to '/' so the attribute value is
 *  identical across platforms. */
export function toRelPath(root: string, filename: string): string {
  const rel = path.relative(root, filename);
  return rel.split(path.sep).join('/');
}
