import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FRAMEWORKS, type Framework } from './frameworks.js';

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  [key: string]: unknown;
}

/**
 * Locate and parse the user's package.json. Returns the parsed contents +
 * the absolute directory it lives in (so callers know the project root
 * for spawning the package manager + resolving config-file paths).
 *
 * Walks up from `startDir` looking for `package.json` — this lets the user
 * run `npx @hover-dev/cli setup` from a subdirectory and still target the
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
 * Heuristic: is this directory a monorepo root that delegates the actual
 * app(s) to workspaces? We recognise the three common shapes:
 *   - pnpm: `pnpm-workspace.yaml`
 *   - npm/yarn: `workspaces` field in package.json
 *   - turbo: `turbo.json` (almost always paired with one of the above)
 * `bolt`, `lerna`, `rush` etc. land via one of these too in practice.
 */
export function isMonorepoRoot(rootDir: string, pkg: PackageJson): boolean {
  if (existsSync(join(rootDir, 'pnpm-workspace.yaml'))) return true;
  if (existsSync(join(rootDir, 'turbo.json'))) return true;
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces.length > 0;
  if (pkg.workspaces && typeof pkg.workspaces === 'object') {
    return Array.isArray(pkg.workspaces.packages) && pkg.workspaces.packages.length > 0;
  }
  return false;
}

/**
 * Enumerate workspace package directories under a monorepo root. Reads the
 * declared globs from pnpm-workspace.yaml or package.json `workspaces`, then
 * resolves each glob against the filesystem. Only supports the common shapes
 * (`packages/*`, `apps/*`, explicit paths) — full glob semantics live in the
 * package manager and we don't want to pull a dep in here.
 *
 * Returns absolute paths to every directory that contains a package.json.
 */
export function findWorkspaces(rootDir: string, pkg: PackageJson): string[] {
  const patterns: string[] = [];
  const pnpmWsPath = join(rootDir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWsPath)) {
    // Minimal YAML scrape — match `- 'apps/*'` / `- "packages/*"` / `- foo`.
    // Avoids a yaml dep; we only need the strings on the `packages:` list.
    const raw = readFileSync(pnpmWsPath, 'utf-8');
    const lines = raw.split(/\r?\n/);
    let inPackages = false;
    for (const line of lines) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (inPackages) {
        const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line);
        if (m) patterns.push(m[1].trim());
        else if (/^\S/.test(line)) break; // next top-level key
      }
    }
  } else if (Array.isArray(pkg.workspaces)) {
    patterns.push(...pkg.workspaces);
  } else if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) {
    patterns.push(...pkg.workspaces.packages);
  }

  const dirs: string[] = [];
  for (const pattern of patterns) {
    // Only `name`, `name/*`, or `name/dir` shapes — no `**`, no negation.
    // Sufficient for the monorepo templates the CLI is likely to meet.
    const cleaned = pattern.replace(/\/$/, '');
    if (cleaned.endsWith('/*')) {
      const parent = join(rootDir, cleaned.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent)) {
        const full = join(parent, entry);
        try {
          if (statSync(full).isDirectory() && existsSync(join(full, 'package.json'))) {
            dirs.push(full);
          }
        } catch { /* skip unreadable entries */ }
      }
    } else {
      const full = join(rootDir, cleaned);
      if (existsSync(join(full, 'package.json'))) dirs.push(full);
    }
  }
  return dirs;
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
  // Walk from rootDir up to the filesystem root, checking each level for a
  // lockfile. Monorepos commit a single lockfile at the repo root and not
  // in workspace subdirectories, so when the CLI dispatches into
  // apps/web/ we'd otherwise see no lockfile and default to npm — wrong
  // for a pnpm-managed monorepo. First lockfile wins; the reason string
  // records where it was found relative to rootDir so the user can see
  // we walked up.
  let dir = rootDir;
  while (true) {
    for (const { file, pm } of lockfileMap) {
      if (existsSync(join(dir, file))) {
        const where = dir === rootDir ? `lockfile ${file}` : `lockfile ${file} at ${dir}`;
        return { pm, reason: where };
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Soft hint: explicit `packageManager` field on the *target* package.json.
  const pkgRaw = readFileSync(join(rootDir, 'package.json'), 'utf-8');
  const pkgManagerMatch = /"packageManager"\s*:\s*"(pnpm|yarn|bun|npm)/.exec(pkgRaw);
  if (pkgManagerMatch) {
    return { pm: pkgManagerMatch[1] as PackageManager, reason: 'packageManager field' };
  }
  return { pm: 'npm', reason: 'no lockfile found; defaulting to npm' };
}
