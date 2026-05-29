import type MagicString from 'magic-string';

/** Common input shape across every framework transform. */
export interface AttributionInput {
  /** The source text the bundler handed us. */
  code: string;
  /** Absolute on-disk filename of `code`. Used to compute the relative
   *  path stamped into `data-hover-source`. */
  filename: string;
  /** Project root the relative path is computed against (usually the
   *  bundler's `config.root` / cwd). */
  root: string;
}

/** Common output shape: MagicString-derived patched code + sourcemap.
 *  `null` means "no host elements found — skip emitting anything". */
export interface AttributionResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

/** Attribute name stamped onto host elements. Read at runtime by the
 *  widget's element picker (see `collectFixContext` in
 *  `@hover-dev/widget-bootstrap/src/widget/client.js`). */
export const SOURCE_ATTR = 'data-hover-source';
