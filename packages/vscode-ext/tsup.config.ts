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
  // Import `.css` as a plain string (inlined into the webview <style>) instead
  // of esbuild's default CSS bundling — lets the chat stylesheet live in a real
  // .css file the maintainer can edit with full tooling, no JS-template escaping.
  loader: { '.css': 'text' },
  clean: true,
  sourcemap: true,
});
