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
export interface ExtraMcpServer {
  /** Stable id of the server. Becomes the JSON key under mcpServers; also
   *  the prefix Claude exposes its tools under (`mcp__<id>__<tool>`). */
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function resolveMcpConfig(opts: {
  /** CDP URL passed to the MCP server's `--cdp-endpoint` flag. */
  cdpUrl: string;
  /** Service port — used to namespace the temp config file. */
  port: number;
  /** Additional MCP servers contributed by active plugins. Each becomes
   *  a key under the mcpServers object. The id is also used to name the
   *  tool prefix Claude exposes (e.g. `mcp__hover_security__list_flows`),
   *  but Claude sanitises non-alphanumeric chars to underscores, so the
   *  caller does NOT need to do that. */
  extra?: ExtraMcpServer[];
  /** Suffix for the output filename so multiple parallel configs from
   *  the same service (e.g. mode toggle round-trips) don't share state. */
  suffix?: string;
  /** Project root to resolve `@playwright/mcp` from. Defaults to
   *  `process.cwd()`. `hover run --cwd apps/web` passes the target workspace
   *  so a monorepo that installed `@hover-dev/core` only under that app (not
   *  the repo root the CLI was invoked from) still resolves the MCP package. */
  cwd?: string;
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
  // The caller may override with an explicit `cwd` (e.g. `hover run --cwd`).
  const require = createRequire(resolve(opts.cwd ?? process.cwd(), 'package.json'));
  const pkgJsonPath = require.resolve('@playwright/mcp/package.json');
  const pkgRoot = dirname(pkgJsonPath);
  // The package's `bin` map declares "playwright-mcp": "cli.js" — we
  // pin to that file directly via Node so the user doesn't need the
  // bin shim on PATH and we skip yet another resolution layer.
  const cliPath = resolve(pkgRoot, 'cli.js');

  const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {
    playwright: {
      command: process.execPath, // current Node binary
      args: [cliPath, '--cdp-endpoint', opts.cdpUrl],
    },
  };
  for (const extra of opts.extra ?? []) {
    // Claude sanitises the key for tool naming; we keep the raw id here
    // because mcp-config consumers (claude / codex) accept arbitrary
    // strings and do their own normalisation.
    mcpServers[extra.id] = {
      command: extra.command,
      args: extra.args,
      env: extra.env,
    };
  }
  const config = { mcpServers };

  const outDir = resolve(tmpdir(), 'hover');
  mkdirSync(outDir, { recursive: true });
  const suffix = opts.suffix ? `-${opts.suffix}` : '';
  const outPath = resolve(outDir, `mcp-config-${opts.port}${suffix}.json`);
  writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf-8');
  return outPath;
}
