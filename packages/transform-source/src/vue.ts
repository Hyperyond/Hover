import { parse } from '@vue/compiler-sfc';
import MagicString from 'magic-string';
import path from 'node:path';
import { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';

// Vue's compiler-core ElementTypes (re-declared here so we don't import
// the symbol — it's a runtime enum that costs a require() chain).
const ELEMENT_TYPE_HOST = 0;

interface VueNode {
  type: number;
  tag?: string;
  tagType?: number;
  props?: Array<{ type: number; name?: string; loc: { start: { offset: number } } }>;
  loc: { start: { offset: number }; end: { offset: number } };
  children?: VueNode[];
}

/** Stamp `data-hover-source` on host elements inside a Vue SFC `<template>`
 *  block. Components (PascalCase or kebab-case treated by Vue as a
 *  component) are skipped. Offsets are SFC-absolute so the patch lands
 *  in the right spot regardless of where the template block starts. */
export function transformVue(input: AttributionInput): AttributionResult | null {
  const { code, filename, root } = input;
  if (!code.includes('<template')) return null;
  let descriptor;
  try {
    descriptor = parse(code).descriptor;
  } catch {
    return null;
  }
  const template = descriptor.template;
  if (!template || !template.ast) return null;
  const relPath = (() => {
    const rel = path.relative(root, filename);
    return rel.split(path.sep).join('/');
  })();
  const s = new MagicString(code);
  let touched = false;

  const visit = (node: VueNode) => {
    if (node.type === 1 && node.tagType === ELEMENT_TYPE_HOST && node.tag) {
      const hasExisting =
        node.props?.some((p) => p.type === 6 && p.name === SOURCE_ATTR) ?? false;
      if (!hasExisting) {
        // Tag-name end = `<` offset + 1 + tagName.length. Insert there so
        // our attribute sits adjacent to the tag name, before any author
        // props. Matches the JSX transform's positioning.
        const insertAt = node.loc.start.offset + 1 + node.tag.length;
        const lineCol = lineColForOffset(code, node.loc.start.offset);
        if (lineCol) {
          const value = `${relPath}:${lineCol.line}:${lineCol.col}`;
          s.appendLeft(insertAt, ` ${SOURCE_ATTR}="${value}"`);
          touched = true;
        }
      }
    }
    if (node.children) for (const child of node.children) visit(child);
  };
  visit(template.ast as unknown as VueNode);

  if (!touched) return null;
  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename }),
  };
}

/** Compute 1-indexed line + 1-indexed column for a byte offset.
 *  Vue's `loc.start.offset` is absolute in the SFC source. We could pull
 *  line/col directly off `node.loc.start` but the JSX transform formats
 *  columns 1-indexed (matching how editors show "Ln 3, Col 12") while
 *  Vue's compiler emits 1-indexed lines + 1-indexed columns too — so we
 *  align here for consistency across frameworks. */
function lineColForOffset(code: string, offset: number): { line: number; col: number } | null {
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
  // Point at the `<` itself; widget reads this to navigate to the tag.
  // The +1 makes it 1-indexed (Vue's loc is already 1-indexed line/col,
  // but we compute from scratch to handle injected offsets uniformly).
  return { line, col };
}
