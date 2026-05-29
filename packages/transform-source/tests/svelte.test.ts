import { describe, it, expect } from 'vitest';
import { transformSvelte } from '../src/svelte.js';

const root = '/repo';
const filename = '/repo/src/App.svelte';

function run(code: string) {
  return transformSvelte({ code, filename, root });
}

describe('transformSvelte', () => {
  it('stamps host elements', () => {
    const out = run(`<script>let count = $state(0);</script>

<div>
  <button onclick={() => count++}>{count}</button>
</div>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<button data-hover-source="src\/App\.svelte:4:3" onclick/);
    expect(out!.code).toMatch(/<div data-hover-source="src\/App\.svelte:3:1"/);
  });

  it('does not stamp PascalCase components', () => {
    const out = run(`<MyButton>nope</MyButton>`);
    expect(out).toBeNull();
  });

  it('skips files without host elements', () => {
    const out = run(`<script>let x = 1;</script>`);
    expect(out).toBeNull();
  });

  it('does not overwrite existing data-hover-source', () => {
    const out = run(`<button data-hover-source="manual">hi</button>`);
    expect(out).toBeNull();
  });

  it('handles nested host + component mix', () => {
    const out = run(`<div>
  <MyButton>nope</MyButton>
  <span>yes</span>
</div>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<div data-hover-source/);
    expect(out!.code).toMatch(/<span data-hover-source/);
    expect(out!.code).not.toMatch(/<MyButton data-hover-source/);
  });

  it('preserves author attributes after the inserted one', () => {
    const out = run(`<input type="text" bind:value={x} />`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<input data-hover-source="[^"]+" type="text" bind:value={x} \/>/);
  });

  it('emits a sourcemap when changes are made', () => {
    const out = run(`<div />`);
    expect(out).not.toBeNull();
    expect(out!.map).toBeDefined();
    expect(typeof out!.map.toString).toBe('function');
  });

  it('uses forward slashes in the relative path', () => {
    const out = transformSvelte({
      code: `<div />`,
      filename: '/repo/src/components/Card.svelte',
      root: '/repo',
    });
    expect(out!.code).toContain('data-hover-source="src/components/Card.svelte:');
  });

  it('returns null on malformed source rather than throwing', () => {
    const out = run(`<div`);
    expect(out === null || typeof out.code === 'string').toBe(true);
  });

  it('skips <svelte:*> special blocks and document-level elements', () => {
    // svelte:head is a SvelteHead node, and <title> inside it is a
    // TitleElement (binds document.title — not a real DOM host). Neither
    // gets a stamp. The plain <div> outside still does.
    const out = run(`<svelte:head><title>hi</title></svelte:head>

<div>real</div>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<div data-hover-source/);
    expect(out!.code).not.toMatch(/<svelte:head data-hover-source/);
    expect(out!.code).not.toMatch(/<title data-hover-source/);
  });
});
