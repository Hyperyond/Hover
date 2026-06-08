import { parse } from 'svelte/compiler';
import MagicString from 'magic-string';
import { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';
import { lineColForOffset, toRelPath } from './util.js';

interface SvelteNode {
  type: string;
  name?: string;
  start: number;
  end: number;
  attributes?: Array<{ type: string; name?: string; start: number; end: number }>;
  fragment?: SvelteNode;
  nodes?: SvelteNode[];
  children?: SvelteNode[];
}

/** Stamp `data-hover-source` on host elements in a Svelte 5 component
 *  (RegularElement). Components (`Component`, `SvelteComponent`,
 *  `SvelteElement`, `SlotElement`, `SvelteSelf`, etc.) are skipped —
 *  Svelte's parser already classifies these distinctly so we get the
 *  same precise filter as Vue. */
export function transformSvelte(input: AttributionInput): AttributionResult | null {
  const { code, filename, root } = input;
  if (!code.includes('<')) return null;
  let ast;
  try {
    ast = parse(code, { modern: true }) as unknown as SvelteNode;
  } catch {
    return null;
  }
  const relPath = toRelPath(root, filename);
  const s = new MagicString(code);
  let touched = false;

  const visit = (node: SvelteNode | undefined) => {
    if (!node) return;
    if (node.type === 'RegularElement' && node.name) {
      const hasExisting =
        node.attributes?.some(
          (a) => a.type === 'Attribute' && a.name === SOURCE_ATTR,
        ) ?? false;
      if (!hasExisting) {
        const insertAt = node.start + 1 + node.name.length;
        const lineCol = lineColForOffset(code, node.start);
        if (lineCol) {
          const value = `${relPath}:${lineCol.line}:${lineCol.col}`;
          s.appendLeft(insertAt, ` ${SOURCE_ATTR}="${value}"`);
          touched = true;
        }
      }
    }
    if (node.fragment) visit(node.fragment);
    if (node.nodes) for (const c of node.nodes) visit(c);
    if (node.children) for (const c of node.children) visit(c);
  };
  visit(ast);

  if (!touched) return null;
  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename }),
  };
}
