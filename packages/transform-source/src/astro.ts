import { parse } from '@astrojs/compiler';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as compilerUtils from '@astrojs/compiler/utils';
const serialize = compilerUtils.serialize as unknown as (node: unknown) => string;
import { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';
import { toRelPath } from './util.js';

interface AstroAttribute {
  type: 'attribute';
  kind: 'quoted' | 'expression' | 'empty' | 'shorthand' | 'spread' | 'template-literal';
  name: string;
  value: string;
  raw: string;
}

interface AstroNode {
  type: string;
  name?: string;
  position?: { start: { line: number; column: number; offset: number } };
  attributes?: AstroAttribute[];
  children?: AstroNode[];
}

/** Stamp `data-hover-source` on host elements inside an Astro template.
 *  Astro classifies tags as `element` (host), `component` (PascalCase or
 *  imported framework component), or `custom-element` (kebab-case Web
 *  Component). Only `element` gets stamped — `custom-element` skipped on
 *  the same principle as Vue's kebab-case rule (user-authored markup
 *  with custom semantics, not a regular DOM host).
 *
 *  Implementation: parse → mutate AST → `serialize()` round-trip. We
 *  cannot use MagicString here because `@astrojs/compiler`'s ASTs come
 *  with `position.start.offset` pointing into the .astro source, but
 *  Astro's own pre-compile pipeline rewrites that source before any
 *  user-registered Vite plugin sees it (`updateConfig({ vite })` plugins
 *  land AFTER Astro's internal `astro:build` plugin in the chain, see
 *  withastro/roadmap#120). Round-tripping through serialize() means our
 *  output is the textual `.astro` source Astro's own compiler will then
 *  consume — that's what the @hover-dev/astro integration uses, via a
 *  server.config.plugins re-order trick. The astro-integration shim
 *  expects this round-trip exactly.
 *
 *  @astrojs/compiler's parse() is WASM-backed and async, so this
 *  transform returns a Promise. Vite/Webpack/etc.'s transform hooks all
 *  accept async returns from transform, so consumers don't need
 *  special handling. */
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
  const relPath = toRelPath(root, filename);
  let touched = false;

  const visit = (node: AstroNode) => {
    if (node.type === 'element' && node.name && node.position) {
      const hasExisting =
        node.attributes?.some((a) => a.name === SOURCE_ATTR) ?? false;
      if (!hasExisting) {
        const { line, column } = node.position.start;
        const value = `${relPath}:${line}:${column}`;
        if (!node.attributes) node.attributes = [];
        node.attributes.push({
          type: 'attribute',
          kind: 'quoted',
          name: SOURCE_ATTR,
          value,
          raw: `"${value}"`,
        });
        touched = true;
      }
    }
    if (node.children) for (const child of node.children) visit(child);
  };
  visit(ast);

  if (!touched) return null;
  // serialize() reconstructs the .astro source text from the mutated AST.
  // Source map: best-effort null — the AST round-trip can change byte
  // offsets in ways MagicString can't represent, and downstream Astro
  // compilation immediately re-tokenises anyway. Returning null is
  // a valid Vite contract (no sourcemap, browser falls back to the
  // file's natural line numbers).
  return {
    code: serialize(ast),
    map: { mappings: '' } as unknown as AttributionResult['map'],
  };
}
