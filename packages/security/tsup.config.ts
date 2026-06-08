import { defineConfig } from 'tsup';

/**
 * Bundle config for `@hover-dev/security`.
 *
 * Why tsup (not tsc): we depend on the private workspace package
 * `@hover-dev/probe-engine`, which is never published to npm. tsup with
 * `noExternal` inlines its compiled output into our own dist, so consumers
 * `pnpm add @hover-dev/security` and get a working plugin without ever seeing
 * the internal package — the same model as `@hover-dev/transform-source` in the
 * bundler shims.
 *
 * Two entries: the plugin entry (`index.ts`) and the MCP server
 * (`mcp/server.ts`), which `index.ts` spawns as a child process via
 * `resolve(here, 'mcp', 'server.js')`. tsup mirrors the path under `src/`, so
 * the second entry lands at `dist/mcp/server.js` — keep both entries or the
 * subprocess launch breaks.
 *
 * What stays external (auto-detected from dependencies / peerDependencies):
 * mockttp, @modelcontextprotocol/sdk, @peculiar/asn1-schema, zod, and the
 * @hover-dev/core peer. Only the dep-free probe engine is inlined.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/mcp/server.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  noExternal: ['@hover-dev/probe-engine'],
});
