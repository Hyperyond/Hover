import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSessionRecord,
  markSessionSaved,
  listSessionRecords,
  parseFindings,
  tallyTools,
  type SessionRecord,
} from '../../src/sessions/sessions.js';

let devRoot: string;
beforeEach(() => {
  devRoot = mkdtempSync(join(tmpdir(), 'hover-sessions-'));
});
afterEach(() => {
  rmSync(devRoot, { recursive: true, force: true });
});

const base = {
  startedAt: '2026-06-12T10:00:00.000Z',
  endedAt: '2026-06-12T10:01:00.000Z',
  agent: 'claude',
  model: 'sonnet',
  prompt: 'log in and add a todo',
  outcome: 'completed' as const,
  turns: 7,
  costUsd: 0.08,
  stepCount: 5,
};

async function readAll(): Promise<SessionRecord[]> {
  return (await listSessionRecords(devRoot)).map(x => x.rec);
}

describe('writeSessionRecord', () => {
  it('writes one meta.json per run under .hover/runs/<conv>/<runId>/', async () => {
    const res = await writeSessionRecord(devRoot, 'conv-1', 'run-1', base);
    expect('path' in res).toBe(true);
    if ('path' in res) {
      expect(res.path.replace(/\\/g, '/')).toContain('/.hover/conversations/conv-1/run-1/meta.json');
      expect(res.id).toBe('run-1');
    }
    const [rec] = await readAll();
    expect(rec.version).toBe(2);
    expect(rec.id).toBe('run-1');
    expect(rec.conversationId).toBe('conv-1');
    expect(rec.prompt).toBe(base.prompt);
    expect(rec.costUsd).toBe(0.08);
    expect(rec.specSlug).toBeUndefined();
  });
});

describe('parseFindings', () => {
  it('splits prose from a ## Findings bullet list with severity markers', () => {
    const summary = [
      'Logged in and added a todo successfully.',
      '',
      '## Findings',
      '- **Bug** — the +1 button has no visible effect',
      '- **Minor** — slow toast on submit',
    ].join('\n');
    const { summary: main, findings } = parseFindings(summary);
    expect(main).toBe('Logged in and added a todo successfully.');
    expect(findings).toEqual([
      { severity: 'Bug', text: 'the +1 button has no visible effect' },
      { severity: 'Minor', text: 'slow toast on submit' },
    ]);
  });

  it('returns no findings when the summary has no Findings block', () => {
    const { summary, findings } = parseFindings('All flows passed.');
    expect(summary).toBe('All flows passed.');
    expect(findings).toEqual([]);
  });

  it('defaults severity to note for an unmarked bullet', () => {
    const { findings } = parseFindings('## Findings\n- counter never increments');
    expect(findings).toEqual([{ severity: 'note', text: 'counter never increments' }]);
  });

  it('strips a tool-call the model emitted as text in the final summary', () => {
    const summary = [
      'Guest mode entered fine; existing progress kept. Waiting for sync.',
      '',
      'call',
      '<invoke name="mcp__playwright__browser_wait_for">',
      '<parameter name="textGone">同步中...</parameter>',
      '</invoke>',
    ].join('\n');
    const { summary: main, findings } = parseFindings(summary);
    expect(main).toBe('Guest mode entered fine; existing progress kept. Waiting for sync.');
    expect(main).not.toContain('<invoke');
    expect(main).not.toContain('browser_wait_for');
    expect(findings).toEqual([]);
  });

  it('strips leaked tool-call noise even with a Findings block present', () => {
    const summary = [
      'Checked login and checkout.',
      '<invoke name="mcp__playwright__browser_snapshot"></invoke>',
      '',
      '## Findings',
      '- **high** — checkout total is wrong',
    ].join('\n');
    const { summary: main, findings } = parseFindings(summary);
    expect(main).toBe('Checked login and checkout.');
    expect(findings).toEqual([{ severity: 'high', text: 'checkout total is wrong' }]);
  });
});

describe('tallyTools', () => {
  it('counts step events by tool name and ignores non-steps', () => {
    const counts = tallyTools([
      { kind: 'user' },
      { kind: 'step', tool: 'browser_snapshot' },
      { kind: 'step', tool: 'browser_click' },
      { kind: 'step', tool: 'browser_snapshot' },
      { kind: 'done' },
    ]);
    expect(counts).toEqual({ browser_snapshot: 2, browser_click: 1 });
  });
});

describe('markSessionSaved', () => {
  it('patches the matching record with outcome=saved + specSlug', async () => {
    await writeSessionRecord(devRoot, 'c1', '2026-06-12T10-00-00-aaaa', base);
    await markSessionSaved(devRoot, base.prompt, 'login-and-todo');
    const [rec] = await readAll();
    expect(rec.outcome).toBe('saved');
    expect(rec.specSlug).toBe('login-and-todo');
  });

  it('is a tolerant no-op when nothing matches (or no ledger exists)', async () => {
    await markSessionSaved(devRoot, 'never ran', 'x'); // no runs yet — must not throw
    await writeSessionRecord(devRoot, 'c1', '2026-06-12T10-00-00-bbbb', base);
    await markSessionSaved(devRoot, 'different prompt', 'x');
    const [rec] = await readAll();
    expect(rec.outcome).toBe('completed');
    expect(rec.specSlug).toBeUndefined();
  });

  it('patches the most recent matching record (newest startedAt) once', async () => {
    await writeSessionRecord(devRoot, 'c1', 'r-old', { ...base, startedAt: '2026-06-12T10:00:00.000Z' });
    await writeSessionRecord(devRoot, 'c1', 'r-new', { ...base, startedAt: '2026-06-12T11:00:00.000Z' });
    await markSessionSaved(devRoot, base.prompt, 'the-spec');
    const saved = (await readAll()).filter(r => r.specSlug === 'the-spec');
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('r-new'); // newest
  });
});
