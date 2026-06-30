import { defineConfig } from 'tsup';

// The `hover-mcp` bin — an MCP stdio server. ESM; deps stay external (resolved
// from node_modules at runtime). When published, `npx @hover-dev/mcp` runs it.
export default defineConfig({
  entry: { mcp: 'src/mcp.ts' },
  format: ['esm'],
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
