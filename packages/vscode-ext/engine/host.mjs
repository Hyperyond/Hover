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
// Per-session isolation (multi-host model): each chat session spawns its own
// host with a distinct CDP port + Chrome profile, so sessions drive separate
// browsers (distinct logins) and can run in parallel. Absent → single-host
// defaults (one Chrome on 9222), unchanged from the pre-multi-host behaviour.
const cdpUrl = process.env.HOVER_CDP_URL || undefined;
const userDataDir = process.env.HOVER_USER_DATA_DIR || undefined;

// Load the optional mode plugins (🟠 security / 🔴 pentest) if they were staged
// into engine/node_modules. Each exposes a `defineHoverPlugin(...)` factory as
// its default export (same contract @hover-dev/next's register uses). A plugin
// that's missing or fails to load (e.g. a mockttp/native-dep hiccup) just
// degrades to "mode unavailable" — it must NEVER stop the engine from booting.
async function loadPlugins() {
  const out = [];
  // 🟠 security (default export of @hover-dev/api-test) and 🔴 pentest (the
  // `/plugin` subpath of @hover-dev/pentest — its main entry is a report lib,
  // not a manifest). pentest reaches the shared MITM via security's
  // startSecurityRuntime; the two modes are mutually exclusive (conflictsWith).
  for (const spec of ['@hover-dev/api-test', '@hover-dev/pentest/plugin']) {
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

let handle;
try {
  const plugins = await loadPlugins();
  handle = await startService({
    port,
    devRoot,
    autoLaunchChrome: false,
    codeContext: true,
    plugins,
    ...(cdpUrl ? { cdpUrl } : {}),
    ...(userDataDir ? { userDataDir } : {}),
  });
} catch (err) {
  // Surface a structured line the parent (engine.ts) can show, instead of a
  // bare unhandled-rejection stack, then exit so the parent's `exit` handler
  // reports it cleanly.
  process.stdout.write(`HOVER_ENGINE_ERROR=${(err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ')}\n`);
  process.exit(1);
}

process.stdout.write(`HOVER_ENGINE_PORT=${handle.port}\n`);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await handle.close();
  } catch {
    /* already closing */
  }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Parent-death watchdog: the extension host spawns us over a stdio pipe. If it
// dies UNCLEANLY (crash / force-kill), `deactivate` → stopEngine never runs and
// we'd orphan this engine + any debug Chrome it launched, holding port 51789.
// The parent's end of our stdin closes when it dies, so self-exit on that.
process.stdin.on('close', shutdown);
process.stdin.on('end', shutdown);
process.stdin.resume();
