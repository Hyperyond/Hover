import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import MagicString from 'magic-string';
import path from 'node:path';
import { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';

// @babel/traverse ships as CJS with the function on .default under ESM import.
// Falls back to the namespace itself for type-only consumers.
const _traverseFn = (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;

/** Stamp `data-hover-source` on host JSX elements (lowercase tag names).
 *  Returns `null` when nothing changed so the bundler can short-circuit. */
export function transformJsx(input: AttributionInput): AttributionResult | null {
  const { code, filename, root } = input;
  if (!code.includes('<')) return null;
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch {
    return null;
  }
  const relPath = (() => {
    const rel = path.relative(root, filename);
    return rel.split(path.sep).join('/');
  })();
  const s = new MagicString(code);
  let touched = false;
  _traverseFn(ast, {
    JSXOpeningElement(p) {
      const node = p.node;
      const name = node.name;
      if (name.type !== 'JSXIdentifier') return;
      const tag = name.name;
      if (!/^[a-z]/.test(tag)) return;
      const hasExisting = node.attributes.some(
        (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === SOURCE_ATTR,
      );
      if (hasExisting) return;
      // Report the `<` position (not the tag name's first char) so
      // every framework transform speaks the same coordinate language:
      // Vue / Svelte / Astro all use `<`-relative line/col, JSX should
      // too. The patch itself still goes right after the tag name —
      // that's the cleanest insertion point and unrelated to what we
      // report.
      const openLoc = node.loc;
      if (!openLoc) return;
      const insertAt = (node.name as { end?: number }).end;
      if (insertAt == null) return;
      const value = `${relPath}:${openLoc.start.line}:${openLoc.start.column + 1}`;
      s.appendLeft(insertAt, ` ${SOURCE_ATTR}="${value}"`);
      touched = true;
    },
  });
  if (!touched) return null;
  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename }),
  };
}
