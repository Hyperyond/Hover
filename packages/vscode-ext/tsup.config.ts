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
  external: ['vscode'],
  clean: true,
  sourcemap: true,
});
