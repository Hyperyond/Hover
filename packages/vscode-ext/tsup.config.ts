import { defineConfig } from 'tsup';

// VSCode loads the extension entry with `require`, so emit CJS. The `vscode`
// module is provided by the host at runtime — it must stay external, never
// bundled. `.cjs` extension keeps it unambiguous regardless of the package's
// future `type` field.
export default defineConfig({
  entry: { extension: 'src/extension.ts' },
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node18',
  // `vscode` is provided by the host. `ws` is BUNDLED (noExternal) so the .vsix
  // is self-contained and `vsce package --no-dependencies` works cleanly in this
  // pnpm monorepo (vsce can't walk pnpm's symlinked node_modules). ws's optional
  // native speedups stay external — ws falls back gracefully without them.
  external: ['vscode', 'bufferutil', 'utf-8-validate'],
  noExternal: ['ws'],
  clean: true,
  sourcemap: true,
});
