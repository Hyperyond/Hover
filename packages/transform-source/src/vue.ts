import { parse } from '@vue/compiler-sfc';
import MagicString from 'magic-string';
import { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';
import { lineColForOffset, toRelPath } from './util.js';

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
  const relPath = toRelPath(root, filename);
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
