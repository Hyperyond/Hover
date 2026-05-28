import { defineConfig } from 'tsup';

/**
 * Bundle config for `webpack-plugin-hover`.
 *
 * Same shape as the other Hover bundler shims: tsup so we can
 * `noExternal` the private `@hover-dev/transform-source` package into
 * our dist; runtime deps + `webpack` / `html-webpack-plugin` peer deps
 * stay external.
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
    'webpack',
    'html-webpack-plugin',
  ],
});
