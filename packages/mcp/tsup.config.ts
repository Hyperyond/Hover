import { defineConfig } from 'tsup';

// Two bins: `hover-mcp` (the MCP stdio server) and `hover-hook` (the Claude
// Code hooks helper). ESM; deps stay external (resolved from node_modules at
// runtime). When published, `npx @hover-dev/mcp` runs the server.
export default defineConfig({
  entry: { mcp: 'src/mcp.ts', hook: 'src/hook.ts' },
  format: ['esm'],
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
