import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendWikiLog, readWikiLog, wikiLogPath } from '../../src/specs/wikiLog.js';

describe('wikiLog', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wikilog-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes a header on first append, then one line per event', async () => {
    await appendWikiLog(dir, 'crystallize', 'checkout.spec.ts — Checkout');
    await appendWikiLog(dir, 'api', 'cart.api-test.spec.ts — Cart API');
    const raw = await readFile(wikiLogPath(dir), 'utf-8');
    expect(raw).toContain('# Hover log'); // header once
    expect(raw.match(/# Hover log/g)).toHaveLength(1);
    expect(raw).toContain('· crystallize · checkout.spec.ts — Checkout');
    expect(raw).toContain('· api · cart.api-test.spec.ts — Cart API');
  });

  it('round-trips through readWikiLog (oldest→newest, parsed)', async () => {
    await appendWikiLog(dir, 'crystallize', 'a.spec.ts — A');
    await appendWikiLog(dir, 'extract', '2 page object(s), folded 3 spec(s)');
    const entries = await readWikiLog(dir);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe('crystallize');
    expect(entries[0].summary).toBe('a.spec.ts — A');
    expect(entries[1].kind).toBe('extract');
    expect(entries[1].iso).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  it('collapses whitespace in the summary so a line stays parseable', async () => {
    await appendWikiLog(dir, 'note', 'multi\nline   summary');
    const [entry] = await readWikiLog(dir);
    expect(entry.summary).toBe('multi line summary');
  });

  it('readWikiLog returns [] when there is no log', async () => {
    expect(await readWikiLog(dir)).toEqual([]);
    expect(existsSync(wikiLogPath(dir))).toBe(false);
  });

  it('honors the limit (keeps the most recent entries)', async () => {
    for (let i = 0; i < 5; i++) await appendWikiLog(dir, 'crystallize', `s${i}.spec.ts`);
    const entries = await readWikiLog(dir, 2);
    expect(entries.map((e) => e.summary)).toEqual(['s3.spec.ts', 's4.spec.ts']);
  });
});
