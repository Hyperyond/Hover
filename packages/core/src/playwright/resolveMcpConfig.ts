import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

/**
 * Resolve a ready-to-use MCP config file path that points at the local
 * `@playwright/mcp` package via an absolute Node-resolved path.
 *
 * Why this exists: Hover originally shipped a static `mcp.config.json`
 * with `"command": "npx", "args": ["-y", "@playwright/mcp@latest", …]`.
 * That meant every `claude -p` invocation kicked off a registry lookup
 * for `@latest` plus a tarball metadata round-trip before the MCP server
 * even started — adding 300 ms - 2 s of dead air to first-token latency
 * on every command (verified via `time npx -y @playwright/mcp@latest`).
 *
 * The fix is to (a) declare `@playwright/mcp` as a real dependency of
 * `@hover-dev/core` so npm resolves it locally at install time, and
 * (b) write a synthetic config file pointing `node <abs-path>/cli.js`
 * at the resolved location. No registry hit on the hot path.
 *
 * The config file is written to `<tmpdir>/hover/mcp-config-<port>.json`,
 * which lets multiple Hover services (one per example app) coexist
 * without stepping on each other's CDP endpoint.
 */
export function resolveMcpConfig(opts: {
  /** CDP URL passed to the MCP server's `--cdp-endpoint` flag. */
  cdpUrl: string;
  /** Service port — used to namespace the temp config file. */
  port: number;
}): string {
  // Resolve the package's main file, then walk back to its package root.
  // Using `package.json` as the resolution target is the documented
  // Node.js pattern for locating an installed package's directory
  // regardless of its main/exports map.
  //
  // The resolution starts from `process.cwd()`, NOT `import.meta.url`.
  // When this module is dynamically imported through Next 16's Turbopack
  // (via `@hover-dev/next`'s `register-node.js`), `import.meta.url` is
  // a virtual "[project]/..." URL that doesn't resolve to a real file
  // on disk — `createRequire` accepts the URL but the resulting
  // `require.resolve('@playwright/mcp/...')` walks the wrong tree and
  // emits a "[project]/..." prefix in the result, which Claude Code
  // can't actually load. `process.cwd()` is the user's project root,
  // and `@playwright/mcp` is always reachable from there because it's
  // a declared dependency of `@hover-dev/core`, which the user installed.
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  const pkgJsonPath = require.resolve('@playwright/mcp/package.json');
  const pkgRoot = dirname(pkgJsonPath);
  // The package's `bin` map declares "playwright-mcp": "cli.js" — we
  // pin to that file directly via Node so the user doesn't need the
  // bin shim on PATH and we skip yet another resolution layer.
  const cliPath = resolve(pkgRoot, 'cli.js');

  const config = {
    mcpServers: {
      playwright: {
        command: process.execPath, // current Node binary
        args: [cliPath, '--cdp-endpoint', opts.cdpUrl],
      },
    },
  };

  const outDir = resolve(tmpdir(), 'hover');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `mcp-config-${opts.port}.json`);
  writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf-8');
  return outPath;
}
