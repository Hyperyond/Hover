import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSessionRecord,
  markSessionSaved,
  sessionsDir,
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

function readAll(): SessionRecord[] {
  return readdirSync(sessionsDir(devRoot))
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(sessionsDir(devRoot), f), 'utf-8')) as SessionRecord);
}

describe('writeSessionRecord', () => {
  it('appends one summary file per run under .hover/sessions/', async () => {
    const res = await writeSessionRecord(devRoot, base);
    expect('path' in res).toBe(true);
    const [rec] = readAll();
    expect(rec.version).toBe(2);
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
    await writeSessionRecord(devRoot, base);
    await markSessionSaved(devRoot, base.prompt, 'login-and-todo');
    const [rec] = readAll();
    expect(rec.outcome).toBe('saved');
    expect(rec.specSlug).toBe('login-and-todo');
  });

  it('is a tolerant no-op when nothing matches (or no ledger exists)', async () => {
    await markSessionSaved(devRoot, 'never ran', 'x'); // no dir — must not throw
    await writeSessionRecord(devRoot, base);
    await markSessionSaved(devRoot, 'different prompt', 'x');
    const [rec] = readAll();
    expect(rec.outcome).toBe('completed');
    expect(rec.specSlug).toBeUndefined();
  });

  it('does not re-patch a record that already has a specSlug', async () => {
    await writeSessionRecord(devRoot, base);
    await markSessionSaved(devRoot, base.prompt, 'first');
    await writeSessionRecord(devRoot, base); // second run, same prompt
    await markSessionSaved(devRoot, base.prompt, 'second');
    const slugs = readAll().map(r => r.specSlug).sort();
    expect(slugs).toEqual(['first', 'second']);
  });
});
