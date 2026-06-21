import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeQaReport, renderQaReport } from '../../src/qa/qaReport.js';

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
  it('writes report.md into the given run folder', async () => {
    const runDirPath = join(devRoot, '.hover', 'conversations', 'conv-1', 'run-1');
    const r1 = await writeQaReport(runDirPath, { ...base, findings: [{ severity: 'high', text: 'bug A' }] });
    expect('path' in r1).toBe(true);
    const p = join(runDirPath, 'report.md');
    expect(readFileSync(p, 'utf-8')).toContain('bug A');
  });

  it('each run (incl. each two-pass phase) has its own folder → no collision', async () => {
    const verifyDir = join(devRoot, '.hover', 'conversations', 'conv-1', 'run-verify');
    const pentestDir = join(devRoot, '.hover', 'conversations', 'conv-1', 'run-pentest');
    await writeQaReport(verifyDir, { ...base, findings: [{ severity: 'high', text: 'verify finding' }] });
    await writeQaReport(pentestDir, { ...base, findings: [{ severity: 'high', text: 'pentest finding' }] });
    expect(readFileSync(join(verifyDir, 'report.md'), 'utf-8')).toContain('verify finding');
    expect(readFileSync(join(pentestDir, 'report.md'), 'utf-8')).toContain('pentest finding');
  });
});
