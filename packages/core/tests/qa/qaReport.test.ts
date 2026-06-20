import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeQaReport, renderQaReport, qaReportsDir } from '../../src/qa/qaReport.js';

let devRoot: string;
beforeEach(() => { devRoot = mkdtempSync(join(tmpdir(), 'hover-qa-')); });
afterEach(() => { rmSync(devRoot, { recursive: true, force: true }); });

const base = {
  prompt: 'Test the checkout flow',
  summary: 'Walked the storefront and checkout; most flows work.',
  endedAt: '2026-06-20T10:00:00.000Z',
  targetUrl: 'http://localhost:5174',
};

describe('renderQaReport', () => {
  it('renders prompt, meta, summary + findings with severities', () => {
    const md = renderQaReport({
      ...base,
      findings: [
        { severity: 'high', text: 'checkout submits with an empty address' },
        { severity: 'low', title: 'Slow toast', text: 'success toast lingers 5s' },
      ],
    });
    expect(md).toContain('# QA report — Test the checkout flow');
    expect(md).toContain('2 findings');
    expect(md).toContain('http://localhost:5174');
    expect(md).toContain('Walked the storefront');
    expect(md).toContain('- **high** — checkout submits with an empty address');
    expect(md).toContain('- **low** — Slow toast — success toast lingers 5s');
  });

  it('says no issues found when there are none', () => {
    const md = renderQaReport({ ...base, findings: [] });
    expect(md).toContain('0 findings');
    expect(md).toContain('_No issues found._');
  });
});

describe('writeQaReport', () => {
  it('writes .hover/qa-reports/<slug>.md and overwrites on re-run', async () => {
    const r1 = await writeQaReport(devRoot, { ...base, findings: [{ severity: 'high', text: 'bug A' }] });
    expect('path' in r1).toBe(true);
    const p = join(qaReportsDir(devRoot), 'test-the-checkout-flow.md');
    expect(readFileSync(p, 'utf-8')).toContain('bug A');
    // Re-run same prompt → same file overwritten (latest wins).
    await writeQaReport(devRoot, { ...base, findings: [{ severity: 'low', text: 'bug B' }] });
    const after = readFileSync(p, 'utf-8');
    expect(after).toContain('bug B');
    expect(after).not.toContain('bug A');
  });
});
