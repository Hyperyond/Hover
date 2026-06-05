import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConventions } from '../../src/service/conventions.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hover-conv-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writeConv(content: string): void {
  mkdirSync(join(root, '.hover'), { recursive: true });
  writeFileSync(join(root, '.hover', 'conventions.md'), content, 'utf-8');
}

describe('readConventions', () => {
  it('returns null when .hover/conventions.md is absent', async () => {
    expect(await readConventions(root)).toBeNull();
  });

  it('returns null when the file is empty or whitespace-only', async () => {
    writeConv('   \n  ');
    expect(await readConventions(root)).toBeNull();
  });

  it('wraps the file content as an exploration-guidance block', async () => {
    writeConv('Login is at /signin. Prefer data-testid selectors.');
    const out = await readConventions(root);
    expect(out).toContain('Project testing conventions');
    expect(out).toContain('guide exploration');
    expect(out).toContain('Login is at /signin. Prefer data-testid selectors.');
  });

  it('caps long files to avoid prompt bloat', async () => {
    writeConv('x'.repeat(10_000));
    const out = await readConventions(root, 100);
    expect(out).toContain('…(truncated)');
    expect(out!.length).toBeLessThan(600);
  });
});
