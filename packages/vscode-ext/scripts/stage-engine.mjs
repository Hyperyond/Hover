/**
 * Stage the Hover engine into `engine/node_modules` as a FLAT install, for the
 * .vsix (Path A — see docs §3.6).
 *
 * Why not esbuild-bundle @hover-dev/core into the extension? Because
 * playwright-core does dynamic `require('chromium-bidi/…')` that esbuild can't
 * resolve. So instead we `npm pack` core and `npm install` the tarball into
 * `engine/`, which gives a normal flat node_modules where playwright-core's
 * runtime requires work. The extension spawns `engine/host.mjs` under plain
 * node, which resolves @hover-dev/core from that node_modules.
 *
 * Run: `pnpm --filter hover-dev stage:engine` (or via the package flow).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..');
const coreDir = join(extRoot, '..', 'core');
const engineDir = join(extRoot, 'engine');

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

// Clean prior staged deps + any leftover tarball.
rmSync(join(engineDir, 'node_modules'), { recursive: true, force: true });
for (const f of readdirSync(engineDir)) if (f.endsWith('.tgz')) rmSync(join(engineDir, f));

// `npm pack` runs core's prepack (clean + build), producing a fresh tarball in engine/.
console.log('[stage-engine] packing @hover-dev/core …');
run('npm', ['pack', '--pack-destination', engineDir], coreDir);
const tgz = readdirSync(engineDir).find((f) => f.endsWith('.tgz'));
if (!tgz) throw new Error('[stage-engine] npm pack produced no tarball');

// Flat, prod-only install into engine/node_modules. --no-save leaves engine/package.json untouched.
console.log('[stage-engine] installing engine into engine/node_modules …');
run('npm', ['install', join(engineDir, tgz), '--no-save', '--omit=dev', '--no-audit', '--no-fund'], engineDir);

rmSync(join(engineDir, tgz));

if (!existsSync(join(engineDir, 'node_modules', '@hover-dev', 'core', 'dist', 'service.js'))) {
  throw new Error('[stage-engine] staged engine is missing @hover-dev/core/dist/service.js');
}
console.log('[stage-engine] done →', join(engineDir, 'node_modules'));
