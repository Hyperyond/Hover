import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureKnowledgeTracked } from '../../src/memory/gitignore.js';

let root: string;
const gi = () => join(root, '.gitignore');
const read = () => readFileSync(gi(), 'utf-8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hover-gi-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ensureKnowledgeTracked', () => {
  it('creates a .gitignore with the managed block when none exists', async () => {
    const r = await ensureKnowledgeTracked(root, {});
    expect(r).toEqual({ changed: true, created: true });
    const s = read();
    expect(s).toContain('.hover/*');
    expect(s).toContain('!.hover/memory/');
    expect(s).toContain('!.hover/hover-map.md');
    expect(s).toContain('!.hover/log.md');
  });

  it('rewrites a bare `.hover` blanket-ignore into `.hover/*` + exceptions', async () => {
    writeFileSync(gi(), 'node_modules\n.env.local\n.hover\n');
    await ensureKnowledgeTracked(root, {});
    const s = read();
    // the harmful blanket line is gone, the user's other lines stay
    expect(s.split('\n')).not.toContain('.hover');
    expect(s).toContain('node_modules');
    expect(s).toContain('.env.local');
    expect(s).toContain('.hover/*');
    expect(s).toContain('!.hover/memory/');
  });

  it('also strips `.hover/` and `/.hover` forms', async () => {
    writeFileSync(gi(), '.hover/\n');
    await ensureKnowledgeTracked(root, {});
    const lines = read().split('\n');
    expect(lines).not.toContain('.hover/');
    expect(lines).not.toContain('/.hover');
    expect(read()).toContain('.hover/*');
  });

  it('is idempotent — a second call changes nothing', async () => {
    await ensureKnowledgeTracked(root, {});
    const first = read();
    const r2 = await ensureKnowledgeTracked(root, {});
    expect(r2).toEqual({ changed: false, reason: 'present' });
    expect(read()).toBe(first);
  });

  it('preserves unrelated `.hover`-adjacent lines (only the blanket line goes)', async () => {
    writeFileSync(gi(), '.hoverboard\n.hover-cache\n');
    await ensureKnowledgeTracked(root, {});
    const s = read();
    expect(s).toContain('.hoverboard');
    expect(s).toContain('.hover-cache');
  });

  it('opts out with HOVER_NO_GITIGNORE and writes nothing', async () => {
    const r = await ensureKnowledgeTracked(root, { HOVER_NO_GITIGNORE: '1' });
    expect(r).toEqual({ changed: false, reason: 'disabled' });
    expect(existsSync(gi())).toBe(false);
  });
});
