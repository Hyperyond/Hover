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
  console.log('[postinstall] core + widget-bootstrap dist is up-to-date, skipping build');
  process.exit(0);
}

const filters = stale.flatMap(p => ['--filter', p.name]);
console.log(`[postinstall] rebuilding stale: ${stale.map(p => p.name).join(', ')}`);
const child = spawn('pnpm', [...filters, 'build'], { stdio: 'inherit', cwd: ROOT });
child.on('exit', code => process.exit(code ?? 1));
