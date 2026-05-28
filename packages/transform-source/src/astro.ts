import { parse } from '@astrojs/compiler';
import MagicString from 'magic-string';
import path from 'node:path';
import { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';

interface AstroNode {
  type: string;
  name?: string;
  position?: { start: { line: number; column: number; offset: number } };
  attributes?: Array<{ name: string; kind: string }>;
  children?: AstroNode[];
}

/** Stamp `data-hover-source` on host elements inside an Astro template.
 *  Astro classifies tags as `element` (host), `component` (PascalCase or
 *  imported framework component), or `custom-element` (kebab-case Web
 *  Component). Only `element` gets stamped — `custom-element` skipped on
 *  the same principle as Vue's kebab-case rule (user-authored markup
 *  with custom semantics, not a regular DOM host).
 *
 *  @astrojs/compiler's parse() is async (WASM-backed), so this transform
 *  returns a Promise. Vite/Webpack/etc.'s transform hooks all accept
 *  async returns, so consumers don't need special handling. */
export async function transformAstro(input: AttributionInput): Promise<AttributionResult | null> {
  const { code, filename, root } = input;
  if (!code.includes('<')) return null;
  let result;
  try {
    result = await parse(code);
  } catch {
    return null;
  }
  const ast = result.ast as unknown as AstroNode;
  const relPath = (() => {
    const rel = path.relative(root, filename);
    return rel.split(path.sep).join('/');
  })();
  const s = new MagicString(code);
  let touched = false;

  const visit = (node: AstroNode) => {
    if (node.type === 'element' && node.name && node.position) {
      const hasExisting =
        node.attributes?.some((a) => a.name === SOURCE_ATTR) ?? false;
      if (!hasExisting) {
        const startOffset = node.position.start.offset;
        const insertAt = startOffset + 1 + node.name.length;
        const { line, column } = node.position.start;
        const value = `${relPath}:${line}:${column}`;
        s.appendLeft(insertAt, ` ${SOURCE_ATTR}="${value}"`);
        touched = true;
      }
    }
    if (node.children) for (const child of node.children) visit(child);
  };
  visit(ast);

  if (!touched) return null;
  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename }),
  };
}
