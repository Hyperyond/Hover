import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stackFrameDirs,
  pluginSearchRoots,
  findPackageJson,
} from '../src/register-node.js';

describe('stackFrameDirs', () => {
  it('parses a parenthesised frame', () => {
    expect(stackFrameDirs('    at fn (/abs/dir/file.js:12:34)')).toEqual(['/abs/dir']);
  });

  it('parses a bare frame with no function name', () => {
    expect(stackFrameDirs('    at /abs/dir/file.cjs:1:2')).toEqual(['/abs/dir']);
  });

  it('parses a file:// frame', () => {
    expect(stackFrameDirs('    at fn (file:///abs/dir/file.mjs:3:4)')).toEqual(['/abs/dir']);
  });

  it('survives paths containing spaces', () => {
    // The regression we shipped and caught: a `[^\s]` class truncated the path
    // at the first space, so "/Volumes/Portable HD/…" never resolved.
    const line =
      '    at register (/Volumes/Portable HD/app/.next/server/instrumentation.js:12:20)';
    expect(stackFrameDirs(line)).toEqual(['/Volumes/Portable HD/app/.next/server']);
  });

  it('ignores the Error header and non-js frames, keeps js frames', () => {
    const stack = ['Error', '    at fn (/a/b.ts:1:1)', '    at obj.m (/c/d.js:2:2)'].join('\n');
    expect(stackFrameDirs(stack)).toEqual(['/c']);
  });

  it('returns [] for an undefined stack', () => {
    expect(stackFrameDirs(undefined)).toEqual([]);
  });
});

describe('pluginSearchRoots', () => {
  it('puts cwd first, then stack dirs, deduplicated', () => {
    const roots = pluginSearchRoots('    at fn (/x/y/z.js:1:1)');
    expect(roots[0]).toBe(process.cwd());
    expect(roots).toContain('/x/y');
    expect(new Set(roots).size).toBe(roots.length);
  });
});

describe('plugin resolution in a pnpm monorepo', () => {
  // Lay out a repo where the plugin is installed ONLY under the app dir, the
  // way pnpm keeps a workspace devDependency (not hoisted to the repo root).
  //   <root>/app/node_modules/@scope/plugin/package.json
  let root: string;
  let appDir: string;
  let pkgJson: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hover-resolve-'));
    appDir = join(root, 'app');
    const pkgDir = join(appDir, 'node_modules', '@scope', 'plugin');
    mkdirSync(pkgDir, { recursive: true });
    pkgJson = join(pkgDir, 'package.json');
    writeFileSync(pkgJson, JSON.stringify({ name: '@scope/plugin' }));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finds the plugin when anchored at the app dir (standard pnpm dev)', () => {
    expect(findPackageJson('@scope/plugin', appDir)).toBe(pkgJson);
  });

  it('returns null when walking up from the repo root (the original bug)', () => {
    expect(findPackageJson('@scope/plugin', root)).toBeNull();
  });

  it('a .next/server stack frame rescues a repo-root launch (the fix)', () => {
    // Next compiles instrumentation.ts into <app>/.next/server/, so even when
    // cwd is the repo root, that frame anchors the walk at the app dir.
    const stack = `Error\n    at register (${join(appDir, '.next', 'server', 'instrumentation.js')}:1:1)`;
    const resolved = pluginSearchRoots(stack)
      .map((r) => findPackageJson('@scope/plugin', r))
      .find(Boolean);
    expect(resolved).toBe(pkgJson);
  });
});
