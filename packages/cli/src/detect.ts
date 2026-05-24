import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FRAMEWORKS, type Framework } from './frameworks.js';

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Locate and parse the user's package.json. Returns the parsed contents +
 * the absolute directory it lives in (so callers know the project root
 * for spawning the package manager + resolving config-file paths).
 *
 * Walks up from `startDir` looking for `package.json` — this lets the user
 * run `npx @hover-dev/cli add` from a subdirectory and still target the
 * project root. Stops at the filesystem root.
 */
export function readUserPackageJson(startDir: string = process.cwd()): { pkg: PackageJson; rootDir: string } | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as PackageJson;
        return { pkg, rootDir: dir };
      } catch {
        return null;
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Detect which framework the user's package.json signals. Returns the
 * highest-priority framework whose `detectDeps` overlap with the user's
 * combined dep tree. Returns null if none match (likely a fresh project
 * or non-JS repo).
 */
export function detectFramework(pkg: PackageJson): Framework | null {
  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const framework of FRAMEWORKS) {
    for (const dep of framework.detectDeps) {
      if (dep in allDeps) return framework;
    }
  }
  return null;
}

/**
 * Detect which package manager the user is on by sniffing the lockfile.
 * Falls back to npm if nothing matches (every Node install has npm), but
 * prints a warning so the user knows we're guessing.
 *
 * Priority is lockfile-first because lockfile commitment is the strongest
 * signal — `packageManager` field in package.json is a softer hint that
 * users often forget to update.
 */
export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

export function detectPackageManager(rootDir: string): { pm: PackageManager; reason: string } {
  const lockfileMap: Array<{ file: string; pm: PackageManager }> = [
    { file: 'pnpm-lock.yaml', pm: 'pnpm' },
    { file: 'yarn.lock', pm: 'yarn' },
    { file: 'bun.lockb', pm: 'bun' },
    { file: 'bun.lock', pm: 'bun' },
    { file: 'package-lock.json', pm: 'npm' },
  ];
  for (const { file, pm } of lockfileMap) {
    if (existsSync(join(rootDir, file))) {
      return { pm, reason: `lockfile ${file}` };
    }
  }
  // Soft hint: explicit `packageManager` field.
  const pkgRaw = readFileSync(join(rootDir, 'package.json'), 'utf-8');
  const pkgManagerMatch = /"packageManager"\s*:\s*"(pnpm|yarn|bun|npm)/.exec(pkgRaw);
  if (pkgManagerMatch) {
    return { pm: pkgManagerMatch[1] as PackageManager, reason: 'packageManager field' };
  }
  return { pm: 'npm', reason: 'no lockfile found; defaulting to npm' };
}
