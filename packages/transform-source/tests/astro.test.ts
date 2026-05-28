import { describe, it, expect } from 'vitest';
import { transformAstro } from '../src/astro.js';

const root = '/repo';
const filename = '/repo/src/pages/index.astro';

async function run(code: string) {
  return await transformAstro({ code, filename, root });
}

describe('transformAstro', () => {
  it('stamps host elements in the template', async () => {
    const out = await run(`---
const count = 1;
---
<div>
  <button onclick="inc">{count}</button>
</div>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<button data-hover-source="src\/pages\/index\.astro:5:3" onclick/);
    expect(out!.code).toMatch(/<div data-hover-source="src\/pages\/index\.astro:4:1"/);
  });

  it('does not stamp PascalCase components', async () => {
    const out = await run(`---
import MyButton from './MyButton.astro';
---
<MyButton>nope</MyButton>`);
    expect(out).toBeNull();
  });

  it('does not stamp kebab-case custom elements', async () => {
    // Astro treats kebab-case tags as custom-element (Web Components),
    // not element. Same skip rationale as Vue's kebab-case rule.
    const out = await run(`<my-button>nope</my-button>`);
    expect(out).toBeNull();
  });

  it('returns null on a template with no host elements', async () => {
    const out = await run(`---
const x = 1;
---
{x}`);
    expect(out).toBeNull();
  });

  it('does not overwrite existing data-hover-source', async () => {
    const out = await run(`<button data-hover-source="manual">hi</button>`);
    expect(out).toBeNull();
  });

  it('handles host + component mix', async () => {
    const out = await run(`---
import MyButton from './MyButton.astro';
---
<div>
  <MyButton>nope</MyButton>
  <span>yes</span>
</div>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<div data-hover-source/);
    expect(out!.code).toMatch(/<span data-hover-source/);
    expect(out!.code).not.toMatch(/<MyButton data-hover-source/);
  });

  it('preserves author attributes after the inserted one', async () => {
    const out = await run(`<input type="text" value="x" />`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<input data-hover-source="[^"]+" type="text" value="x" \/>/);
  });

  it('emits a sourcemap when changes are made', async () => {
    const out = await run(`<div />`);
    expect(out).not.toBeNull();
    expect(out!.map).toBeDefined();
    expect(typeof out!.map.toString).toBe('function');
  });

  it('uses forward slashes in the relative path', async () => {
    const out = await transformAstro({
      code: `<div />`,
      filename: '/repo/src/components/Card.astro',
      root: '/repo',
    });
    expect(out!.code).toContain('data-hover-source="src/components/Card.astro:');
  });
});
