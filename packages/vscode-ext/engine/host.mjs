#!/usr/bin/env node
/**
 * Hover engine host — the child process the VSCode extension spawns.
 *
 * Path A (engine-in-extension): instead of bundling @hover-dev/core through
 * esbuild (which fails — playwright-core does dynamic `require('chromium-bidi')`
 * that can't be bundled), we ship a FLAT node_modules of the engine inside the
 * .vsix and spawn this script under plain Node (the extension uses
 * `process.execPath` + ELECTRON_RUN_AS_NODE=1 so it doesn't need system node).
 * Node resolves @hover-dev/core normally from the shipped node_modules, so
 * playwright-core's requires work at runtime.
 *
 * Contract: reads HOVER_DEV_ROOT + HOVER_PORT from env, boots the WS service,
 * prints `HOVER_ENGINE_PORT=<port>` on stdout so the parent learns the bound
 * port, then stays alive until SIGTERM/SIGINT.
 */
import { startService } from '@hover-dev/core/service';

const devRoot = process.env.HOVER_DEV_ROOT || process.cwd();
const port = Number(process.env.HOVER_PORT || 51789);

const handle = await startService({
  port,
  devRoot,
  autoLaunchChrome: false,
  codeContext: true,
});

process.stdout.write(`HOVER_ENGINE_PORT=${handle.port}\n`);

const shutdown = async () => {
  try {
    await handle.close();
  } catch {
    /* already closing */
  }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
