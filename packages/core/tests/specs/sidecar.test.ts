import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSidecar,
  readSidecar,
  sidecarDir,
  legacySidecarDir,
} from '../../src/specs/sidecar.js';

let devRoot: string;
beforeEach(() => {
  devRoot = mkdtempSync(join(tmpdir(), 'hover-sidecar-'));
});
afterEach(() => {
  rmSync(devRoot, { recursive: true, force: true });
});

const steps = [{ kind: 'step' as const, tool: 'browser_click', input: { element: 'Go' } }];

describe('sidecar relocation (.hover/sidecars/)', () => {
  it('writes to the project-root .hover/sidecars/, not inside __vibe_tests__', async () => {
    const path = await writeSidecar(devRoot, { slug: 's1', name: 's1', steps, assertions: [] });
    expect(path).toBe(join(devRoot, '.hover', 'sidecars', 's1.json'));
    expect(path).not.toContain('__vibe_tests__');
  });

  it('falls back to the legacy __vibe_tests__/.hover/ home and copies forward', async () => {
    mkdirSync(legacySidecarDir(devRoot), { recursive: true });
    writeFileSync(
      join(legacySidecarDir(devRoot), 'old.json'),
      JSON.stringify({ version: 1, slug: 'old', name: 'old', createdAt: 'x', steps, assertions: [] }),
    );
    const sc = await readSidecar(devRoot, 'old');
    expect(sc?.slug).toBe('old');
    // Lazy migration: next read hits the new home.
    expect(existsSync(join(sidecarDir(devRoot), 'old.json'))).toBe(true);
  });

  it('prefers the current home when both exist', async () => {
    mkdirSync(legacySidecarDir(devRoot), { recursive: true });
    writeFileSync(
      join(legacySidecarDir(devRoot), 'dup.json'),
      JSON.stringify({ slug: 'dup', name: 'legacy-copy', steps }),
    );
    await writeSidecar(devRoot, { slug: 'dup', name: 'current-copy', steps, assertions: [] });
    const sc = await readSidecar(devRoot, 'dup');
    expect(sc?.name).toBe('current-copy');
  });

  it('returns null when absent', async () => {
    expect(await readSidecar(devRoot, 'nope')).toBeNull();
  });
});
