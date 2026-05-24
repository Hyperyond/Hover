import { spawn } from 'node:child_process';
import type { PackageManager } from './detect.js';

/**
 * Map (package manager, install kind) → argv. Each PM has its own dialect:
 *   - `pnpm add -D`, `yarn add -D`, `bun add -d`, `npm install --save-dev`.
 * We pin to dev-dependency installs because every Hover integration is a
 * dev-only tool (no production runtime code).
 */
function buildInstallArgv(pm: PackageManager, pkg: string): string[] {
  switch (pm) {
    case 'pnpm':
      return ['add', '-D', pkg];
    case 'yarn':
      return ['add', '-D', pkg];
    case 'bun':
      return ['add', '-d', pkg];
    case 'npm':
      return ['install', '--save-dev', pkg];
  }
}

/**
 * Spawn the user's package manager with the install command. Inherits stdio
 * so the user sees the PM's native progress output (it's better than
 * anything we could synthesise). Resolves with the exit code; the caller
 * decides whether to bail.
 *
 * `cwd` should be the user's project root (where package.json lives) —
 * `detect.readUserPackageJson` returns it as `rootDir`.
 */
export function installPackage(pm: PackageManager, pkg: string, cwd: string): Promise<number> {
  return new Promise((resolveExit, rejectExit) => {
    const argv = buildInstallArgv(pm, pkg);
    const child = spawn(pm, argv, { cwd, stdio: 'inherit' });
    child.on('error', rejectExit);
    child.on('exit', code => resolveExit(code ?? -1));
  });
}
