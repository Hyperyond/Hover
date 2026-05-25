import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import MagicString from 'magic-string';
import path from 'node:path';

// @babel/traverse ships as CJS with the function on .default under ESM import.
// Falls back to the namespace itself for type-only consumers.
const traverse = (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;

export interface AttributionInput {
  code: string;
  filename: string;
  root: string;
}

export interface AttributionResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

const ATTR = 'data-hover-source';

export function transformSourceAttribution(input: AttributionInput): AttributionResult | null {
  const { code, filename, root } = input;

  // Fast bail: no JSX-looking content.
  if (!code.includes('<')) return null;

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      plugins: ['jsx', 'typescript'],
    });
  } catch {
    // Syntax error — let Vite's own parser surface it. Don't crash the dev server.
    return null;
  }

  const relPath = toRelative(filename, root);
  const s = new MagicString(code);
  let touched = false;

  traverse(ast, {
    JSXOpeningElement(p) {
      const node = p.node;
      const name = node.name;

      // Only stamp host elements (lowercase tag names — <button>, <div>).
      // Component elements (<Button>, <Card.Body>) render to whatever their
      // implementation does; stamping on the component call site doesn't end
      // up on a DOM node anyway. We rely on the wrapper's *own* JSX (the
      // <button> inside it) being transformed too.
      if (name.type !== 'JSXIdentifier') return;
      const tag = name.name;
      if (!/^[a-z]/.test(tag)) return;

      // Skip if user already authored a data-hover-source — respects manual overrides.
      const hasExisting = node.attributes.some(
        (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === ATTR,
      );
      if (hasExisting) return;

      const loc = node.name.loc;
      if (!loc) return;

      // Insert immediately after the tag name. Babel locations are 1-based
      // line and 0-based column; the .end offset is what magic-string needs.
      const insertAt = (node.name as { end?: number }).end;
      if (insertAt == null) return;

      const value = `${relPath}:${loc.start.line}:${loc.start.column + 1}`;
      s.appendLeft(insertAt, ` ${ATTR}="${value}"`);
      touched = true;
    },
  });

  if (!touched) return null;

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename }),
  };
}

function toRelative(filename: string, root: string): string {
  const rel = path.relative(root, filename);
  // On Windows path.relative returns backslashes; normalize to forward slashes
  // so the attribute value is stable across OSes.
  return rel.split(path.sep).join('/');
}
