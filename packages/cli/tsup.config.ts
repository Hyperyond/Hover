import { defineConfig } from 'tsup';

// The `hover` bin. ESM (ink + react are ESM-only). `dependencies` /
// `peerDependencies` stay external by default — ink/react/core resolve from the
// package's node_modules at runtime, which keeps dev builds fast. When we cut a
// publishable `npx @hover-dev/cli`, switch to a bundled build instead.
export default defineConfig({
  entry: { cli: 'src/cli.tsx', mcp: 'src/mcp.ts' },
  format: ['esm'],
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
