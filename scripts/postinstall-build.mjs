#!/usr/bin/env node
// Builds @hover-dev/core and @hover-dev/widget-bootstrap, but ONLY when
// their `dist/` artefacts are stale or missing. Plain `pnpm --filter ... build`
// in postinstall reran on every `pnpm install` (including `pnpm add <unrelated>`
// in any user-of-this-repo workflow), wasting tens of seconds. This script
// makes postinstall a no-op on hot installs.
//
// Staleness rule: a package is stale if any file under `src/` (recursively)
// has an mtime newer than the oldest file under `dist/`. New `src/` files,
// touched files, deleted+readded files all trigger rebuild. `dist/` not
// existing is also stale.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const PACKAGES = [
  { name: '@hover-dev/core', dir: join(ROOT, 'packages/core') },
  { name: '@hover-dev/widget-bootstrap', dir: join(ROOT, 'packages/widget-bootstrap') },
  // Security ships as a `main: dist/...` package because examples that
  // import it (basic-app's vite.config.ts) typecheck against the
  // published .d.ts, not the source .ts. A fresh-clone workflow that
  // runs `pnpm install` + `pnpm typecheck` would otherwise fail with
  // "Cannot find module '@hover-dev/security' or its corresponding
  // type declarations" — surfaced when this combination landed in CI's
  // publish.yml release gate for v0.7.0.
  { name: '@hover-dev/security', dir: join(ROOT, 'packages/security') },
  // Private workspace package (never published). Ships as `main: dist/...`
  // because (a) its source is multi-file and Node's strict ESM resolver
  // can't follow `./types.js` imports back to on-disk `.ts` files when a
  // consumer like vite-plugin-hover loads via Vite's user-config path,
  // and (b) every integration shim's tsup build will inline this package
  // into its own dist via `noExternal`, so dist artefacts must exist
  // before those shims build.
  { name: '@hover-dev/transform-source', dir: join(ROOT, 'packages/transform-source') },
];

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = newestMtime(full);
      if (sub > newest) newest = sub;
    } else if (entry.isFile()) {
      const m = statSync(full).mtimeMs;
      if (m > newest) newest = m;
    }
  }
  return newest;
}

function oldestMtime(dir) {
  let oldest = Infinity;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = oldestMtime(full);
      if (sub < oldest) oldest = sub;
    } else if (entry.isFile()) {
      const m = statSync(full).mtimeMs;
      if (m < oldest) oldest = m;
    }
  }
  return oldest === Infinity ? 0 : oldest;
}

function isStale(pkgDir) {
  const src = join(pkgDir, 'src');
  const dist = join(pkgDir, 'dist');
  if (!existsSync(dist)) return true;
  // An empty dist counts as stale.
  try {
    if (readdirSync(dist).length === 0) return true;
  } catch {
    return true;
  }
  const srcNewest = newestMtime(src);
  const distOldest = oldestMtime(dist);
  return srcNewest > distOldest;
}

const stale = PACKAGES.filter(p => isStale(p.dir));
if (stale.length === 0) {
  console.log('[postinstall] all dist-shape packages up-to-date, skipping build');
  process.exit(0);
}

const filters = stale.flatMap(p => ['--filter', p.name]);
console.log(`[postinstall] rebuilding stale: ${stale.map(p => p.name).join(', ')}`);
const child = spawn('pnpm', [...filters, 'build'], { stdio: 'inherit', cwd: ROOT });
child.on('exit', code => process.exit(code ?? 1));
