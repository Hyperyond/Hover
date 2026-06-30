import { defineConfig } from 'vitest/config';

// ink components are .tsx — tell esbuild to use the automatic JSX runtime so
// tests can render them without importing React explicitly everywhere.
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
