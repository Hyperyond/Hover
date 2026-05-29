import { defineConfig } from 'tsup';

/**
 * Bundle config for `@hover-dev/nuxt`.
 *
 * Same shape as the other Hover bundler shims (vite-plugin-hover,
 * @hover-dev/astro): tsup so we can `noExternal` the private
 * `@hover-dev/transform-source` package into our dist, while the
 * runtime deps (`@hover-dev/core`, widget-bootstrap, `@nuxt/kit`,
 * `nuxt`, and the transform-source bundler dep chain) stay external.
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
    '@nuxt/kit',
    'nuxt',
  ],
});
