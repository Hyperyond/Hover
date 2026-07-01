import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadMemory,
  writeFact,
  formatMemoryForPrompt,
  formatMemoryIndex,
  recallMemory,
  readFact,
  formatFact,
  RECALL_INLINE_BUDGET,
  memoryDir,
  slugify,
  type BusinessFact,
} from '../../src/memory/businessMemory.js';

let devRoot: string;
beforeEach(() => {
  devRoot = mkdtempSync(join(tmpdir(), 'hover-mem-'));
});
afterEach(() => {
  rmSync(devRoot, { recursive: true, force: true });
});

describe('slugify', () => {
  it('kebab-cases + trims to a safe stem', () => {
    expect(slugify('Checkout tax: EU VAT!')).toBe('checkout-tax-eu-vat');
    expect(slugify('   ')).toBe('fact');
  });
});

describe('writeFact + loadMemory round-trip', () => {
  it('writes a fact file + index line and reads it back', async () => {
    const fact: BusinessFact = {
      name: 'checkout-tax',
      description: 'EU orders include 20% VAT in the total',
      type: 'business-rule',
      body: 'On checkout, the displayed total for an EU shipping address includes 20% VAT.',
    };
    const res = await writeFact(devRoot, fact);
    expect('path' in res).toBe(true);

    const loaded = await loadMemory(devRoot);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ name: 'checkout-tax', type: 'business-rule', description: fact.description });
    expect(loaded[0].body).toContain('20% VAT');

    const index = readFileSync(join(memoryDir(devRoot), 'MEMORY.md'), 'utf-8');
    expect(index).toContain('[checkout-tax](checkout-tax.md)');
    expect(index).toContain('20% VAT');
  });

  it('re-writing the same fact updates, not duplicates, the index line', async () => {
    const base: BusinessFact = { name: 'auth-lockout', description: 'old', type: 'access-policy', body: 'old body' };
    await writeFact(devRoot, base);
    await writeFact(devRoot, { ...base, description: 'locks after 5 tries', body: 'Account locks for 15m after 5 failed logins.' });
    const index = readFileSync(join(memoryDir(devRoot), 'MEMORY.md'), 'utf-8');
    expect(index.match(/auth-lockout\.md/g)).toHaveLength(1); // one line, not two
    expect(index).toContain('locks after 5 tries');
    const loaded = await loadMemory(devRoot);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].body).toContain('15m');
  });

  it('defaults an unknown type to business-rule', async () => {
    await writeFact(devRoot, { name: 'x', description: 'd', type: 'weird' as never, body: 'b' });
    const [f] = await loadMemory(devRoot);
    expect(f.type).toBe('business-rule');
  });
});

describe('loadMemory robustness', () => {
  it('returns [] when no memory dir exists', async () => {
    expect(await loadMemory(devRoot)).toEqual([]);
  });

  it('ignores MEMORY.md and malformed/no-frontmatter files', async () => {
    const dir = memoryDir(devRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'MEMORY.md'), '# index\n- [a](a.md) — hook\n');
    writeFileSync(join(dir, 'bad.md'), 'no frontmatter here');
    writeFileSync(join(dir, 'good.md'), '---\nname: good\ndescription: real\ntype: validation\n---\nA real fact.');
    const loaded = await loadMemory(devRoot);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('good');
    expect(loaded[0].type).toBe('validation');
  });
});

describe('formatMemoryForPrompt', () => {
  it('returns empty string for no facts (caller appends nothing)', () => {
    expect(formatMemoryForPrompt([])).toBe('');
  });

  it('renders one bullet per fact under a ground-truth header', () => {
    const out = formatMemoryForPrompt([
      { name: 'a', description: 'rule A', type: 'business-rule', body: 'body A' },
      { name: 'b', description: '', type: 'validation', body: 'body B' },
    ]);
    expect(out).toContain('KNOWN BUSINESS KNOWLEDGE');
    expect(out).toContain('- rule A — body A');
    expect(out).toContain('- body B');
  });
});

describe('progressive recall (index vs full + on-demand)', () => {
  const bulk = (n: number): BusinessFact[] =>
    Array.from({ length: n }, (_, i) => ({
      name: `rule-${i}`,
      description: `desc ${i}`,
      type: 'business-rule' as const,
      body: 'x'.repeat(200), // fat body so the set blows the inline budget
    }));

  it('formatMemoryIndex lists one name/description/type line per rule, no bodies', () => {
    const out = formatMemoryIndex([
      { name: 'guests-cannot-checkout', description: 'must log in first', type: 'access-policy', body: 'LONG BODY TEXT' },
    ]);
    expect(out).toContain('recall_fact');
    expect(out).toContain('- guests-cannot-checkout — must log in first (access-policy)');
    expect(out).not.toContain('LONG BODY TEXT');
  });

  it('recallMemory inlines full bodies when the set is small', async () => {
    await writeFact(devRoot, { name: 'small', description: 'd', type: 'validation', body: 'the full body' });
    const out = await recallMemory(devRoot);
    expect(out).toContain('the full body'); // full, not index
    expect(out.length).toBeLessThanOrEqual(RECALL_INLINE_BUDGET + 500);
  });

  it('recallMemory switches to the INDEX when the set is large', async () => {
    for (const f of bulk(20)) await writeFact(devRoot, f);
    const out = await recallMemory(devRoot);
    expect(out).toContain('20 rules'); // index header
    expect(out).toContain('recall_fact');
    expect(out).not.toContain('x'.repeat(200)); // no bodies inlined
  });

  it('recallMemory is empty when nothing is remembered', async () => {
    expect(await recallMemory(devRoot)).toBe('');
  });

  it('readFact fetches one rule by exact, then fuzzy, name; null when absent', async () => {
    await writeFact(devRoot, { name: 'checkout-tax', description: 'VAT', type: 'business-rule', body: 'includes 20% VAT' });
    expect((await readFact(devRoot, 'checkout-tax'))?.body).toContain('20% VAT');
    expect((await readFact(devRoot, 'Checkout Tax'))?.name).toBe('checkout-tax'); // slugified match
    expect((await readFact(devRoot, 'checkout'))?.name).toBe('checkout-tax'); // prefix match
    expect(await readFact(devRoot, 'nonexistent')).toBeNull();
  });

  it('formatFact renders the body verbatim (not whitespace-collapsed)', () => {
    const out = formatFact({ name: 'r', description: 'd', type: 'validation', body: 'line one\n\nline two' });
    expect(out).toContain('r — d (validation)');
    expect(out).toContain('line one\n\nline two');
  });
});
