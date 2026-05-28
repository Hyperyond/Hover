import { defineConfig } from 'tsup';

/**
 * Bundle config for `@hover-dev/astro`.
 *
 * tsup (not tsc) because we need `noExternal` to inline
 * `@hover-dev/transform-source` (a private workspace package never
 * published to npm) into our dist. The widget-bootstrap + core deps
 * stay external — see vite-plugin-hover's tsup.config.ts for the
 * full rationale (asset-relative import.meta.url + edge-runtime
 * isolation reasons).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  noExternal: ['@hover-dev/transform-source'],
  external: [
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    '@vue/compiler-sfc',
    '@astrojs/compiler',
    'svelte',
    'svelte/compiler',
    'magic-string',
    'astro',
  ],
});
