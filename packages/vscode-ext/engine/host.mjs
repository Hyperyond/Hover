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

// Load the optional mode plugins (🟠 security / 🔴 pentest) if they were staged
// into engine/node_modules. Each exposes a `defineHoverPlugin(...)` factory as
// its default export (same contract @hover-dev/next's register uses). A plugin
// that's missing or fails to load (e.g. a mockttp/native-dep hiccup) just
// degrades to "mode unavailable" — it must NEVER stop the engine from booting.
async function loadPlugins() {
  const out = [];
  // Only @hover-dev/security is a mode plugin today. @hover-dev/pentest is a
  // findings-report renderer, not a defineHoverPlugin manifest — the 🔴 pentest
  // *mode* plugin isn't built yet, so it's not loaded here.
  for (const spec of ['@hover-dev/security']) {
    try {
      const mod = await import(spec);
      const factory = mod.default;
      const manifest = typeof factory === 'function' ? factory() : factory;
      if (manifest && typeof manifest === 'object' && 'name' in manifest) {
        out.push(manifest);
      } else {
        console.error(`[hover-engine] ${spec}: no plugin manifest exported; skipping`);
      }
    } catch (err) {
      console.error(`[hover-engine] ${spec} not loaded:`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

const plugins = await loadPlugins();

const handle = await startService({
  port,
  devRoot,
  autoLaunchChrome: false,
  codeContext: true,
  plugins,
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
