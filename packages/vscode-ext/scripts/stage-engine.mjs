/**
 * Stage the Hover engine into `engine/node_modules` as a FLAT install, for the
 * .vsix (Path A — see docs §3.6).
 *
 * Why not esbuild-bundle @hover-dev/core into the extension? Because
 * playwright-core does dynamic `require('chromium-bidi/…')` that esbuild can't
 * resolve. So instead we `pnpm pack` core (+ the mode plugins) and `npm install`
 * the tarballs into `engine/`, which gives a normal flat node_modules where
 * playwright-core's runtime requires work. The extension spawns
 * `engine/host.mjs` under plain node, which resolves these from node_modules.
 *
 * We also stage both mode plugins so 🟠 security + 🔴 pentest work in the
 * extension (host.mjs loads them into startService({ plugins })):
 *   - @hover-dev/api-test — the orange mode; self-contained (public npm deps).
 *   - @hover-dev/pentest  — the red mode lives at its `./plugin` subpath and
 *     reaches the shared MITM via security's startSecurityRuntime. It depends
 *     on @hover-dev/api-test, so it's installed AFTER it (the already-present
 *     security satisfies the dep — no registry hit). `pnpm pack` rewrites
 *     pentest's `workspace:*` security dep to a concrete version.
 *
 * Run: `pnpm --filter hover-dev stage:engine` (or via the package flow).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..');
const repoRoot = join(extRoot, '..', '..');
const engineDir = join(extRoot, 'engine');
const pkgDir = (name) => join(extRoot, '..', name); // packages/<name>

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

// Clean prior staged deps + any leftover tarballs.
rmSync(join(engineDir, 'node_modules'), { recursive: true, force: true });
for (const f of readdirSync(engineDir)) if (f.endsWith('.tgz')) rmSync(join(engineDir, f));

// Build engine packages first, in dependency order, so the packed dists exist.
console.log('[stage-engine] building core + security + pentest …');
run('pnpm', ['--filter', '@hover-dev/core', '--filter', '@hover-dev/api-test', '--filter', '@hover-dev/pentest', 'build'], repoRoot);

/** pnpm-pack a package into engineDir and return the new tarball's path. */
function packInto(dir) {
  const before = new Set(readdirSync(engineDir).filter((f) => f.endsWith('.tgz')));
  run('pnpm', ['pack', '--pack-destination', engineDir], dir);
  const added = readdirSync(engineDir).filter((f) => f.endsWith('.tgz')).find((f) => !before.has(f));
  if (!added) throw new Error(`[stage-engine] pnpm pack produced no tarball for ${dir}`);
  return join(engineDir, added);
}

console.log('[stage-engine] packing core + security + pentest …');
const coreTgz = packInto(pkgDir('core'));
const securityTgz = packInto(pkgDir('security'));
const pentestTgz = packInto(pkgDir('pentest'));

const npmFlags = ['--no-save', '--omit=dev', '--no-audit', '--no-fund'];

// security is self-contained (its deps are public npm packages), so core +
// security resolve cleanly together.
console.log('[stage-engine] installing core + security into engine/node_modules …');
run('npm', ['install', coreTgz, securityTgz, ...npmFlags], engineDir);

// pentest depends on @hover-dev/api-test, now present at the same version →
// satisfied without a registry hit. Best-effort: never block the .vsix on it.
console.log('[stage-engine] installing pentest …');
try {
  run('npm', ['install', pentestTgz, ...npmFlags], engineDir);
} catch (err) {
  console.warn(`[stage-engine] pentest install failed — 🔴 mode will be unavailable: ${err?.message ?? err}`);
}

// Drop the tarballs (they're .vscodeignore'd anyway, but keep engine/ tidy).
for (const t of [coreTgz, securityTgz, pentestTgz]) rmSync(t, { force: true });

// Verify the required dists landed.
const must = [
  ['@hover-dev/core', 'dist/service.js'],
  ['@hover-dev/api-test', 'dist/index.js'],
];
for (const [pkg, rel] of must) {
  if (!existsSync(join(engineDir, 'node_modules', ...pkg.split('/'), ...rel.split('/')))) {
    throw new Error(`[stage-engine] staged engine is missing ${pkg}/${rel}`);
  }
}
const hasPentest = existsSync(join(engineDir, 'node_modules', '@hover-dev', 'pentest', 'dist', 'plugin.js'));
console.log(`[stage-engine] done → ${join(engineDir, 'node_modules')} (pentest: ${hasPentest ? 'staged' : 'MISSING'})`);
