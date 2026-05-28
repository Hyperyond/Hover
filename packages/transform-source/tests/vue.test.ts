import { describe, it, expect } from 'vitest';
import { transformVue } from '../src/vue.js';

const root = '/repo';
const filename = '/repo/src/App.vue';

function run(code: string) {
  return transformVue({ code, filename, root });
}

describe('transformVue', () => {
  it('stamps host elements in the template block', () => {
    const out = run(`<template>
  <div>
    <button @click="inc">{{ count }}</button>
  </div>
</template>
<script setup>const count = 1;</script>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<button data-hover-source="src\/App\.vue:3:5" @click/);
    expect(out!.code).toMatch(/<div data-hover-source="src\/App\.vue:2:3"/);
  });

  it('does not stamp PascalCase components', () => {
    const out = run(`<template>
  <MyButton>nope</MyButton>
</template>`);
    expect(out).toBeNull();
  });

  it('does not stamp kebab-case custom components either', () => {
    // Vue treats kebab-case unknown tags as components, not host elements.
    const out = run(`<template>
  <my-button>nope</my-button>
</template>`);
    expect(out).toBeNull();
  });

  it('skips files without a <template> block', () => {
    const out = run(`<script setup>const x = 1;</script>`);
    expect(out).toBeNull();
  });

  it('returns null when nothing host-shaped found', () => {
    const out = run(`<template>{{ msg }}</template>`);
    expect(out).toBeNull();
  });

  it('does not overwrite existing data-hover-source', () => {
    const out = run(`<template><button data-hover-source="manual">hi</button></template>`);
    expect(out).toBeNull();
  });

  it('handles nested host + component mix', () => {
    const out = run(`<template>
  <div>
    <MyButton>nope</MyButton>
    <span>yes</span>
  </div>
</template>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<div data-hover-source/);
    expect(out!.code).toMatch(/<span data-hover-source/);
    expect(out!.code).not.toMatch(/<MyButton data-hover-source/);
  });

  it('preserves author props after the inserted attribute', () => {
    const out = run(`<template>
  <input type="text" :value="x" />
</template>`);
    expect(out).not.toBeNull();
    expect(out!.code).toMatch(/<input data-hover-source="[^"]+" type="text" :value="x" \/>/);
  });

  it('emits a sourcemap when changes are made', () => {
    const out = run(`<template><div /></template>`);
    expect(out).not.toBeNull();
    expect(out!.map).toBeDefined();
    expect(typeof out!.map.toString).toBe('function');
  });

  it('uses forward slashes in the relative path', () => {
    const out = transformVue({
      code: `<template><div /></template>`,
      filename: '/repo/src/components/Card.vue',
      root: '/repo',
    });
    expect(out!.code).toContain('data-hover-source="src/components/Card.vue:');
  });

  it('returns null on malformed template rather than throwing', () => {
    const out = run(`<template><div`);
    // Vue's compiler is forgiving; either it returns valid ast or we get
    // null. Either is acceptable as long as we don't throw.
    expect(out === null || typeof out.code === 'string').toBe(true);
  });
});
