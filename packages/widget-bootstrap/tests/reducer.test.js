import { describe, it, expect } from 'vitest';
import {
  groupMessages,
  extractFindings,
  stripMarkdown,
  classifySeverity,
  NOTEWORTHY_AI,
  HIDDEN_TOOLS,
  BOUNDARY_TOOLS,
  MAX_TOOLS_PER_GROUP,
} from '../src/widget/reducer.js';

describe('classifySeverity', () => {
  it('classifies bug markers as bug', () => {
    expect(classifySeverity('Bug')).toBe('bug');
    expect(classifySeverity('Bug #1')).toBe('bug');
    expect(classifySeverity('Critical')).toBe('bug');
    expect(classifySeverity('Severe')).toBe('bug');
  });
  it('classifies minor markers as minor', () => {
    expect(classifySeverity('Minor')).toBe('minor');
    expect(classifySeverity('Warning')).toBe('minor');
    expect(classifySeverity('Note')).toBe('minor');
  });
  it('defaults to info', () => {
    expect(classifySeverity(null)).toBe('info');
    expect(classifySeverity('')).toBe('info');
    expect(classifySeverity('Observation')).toBe('info');
  });
});

describe('stripMarkdown', () => {
  it('strips ATX headings but keeps the text', () => {
    expect(stripMarkdown('## Verification')).toBe('Verification');
    expect(stripMarkdown('### Steps')).toBe('Steps');
    expect(stripMarkdown('# Title')).toBe('Title');
  });
  it('strips list markers', () => {
    expect(stripMarkdown('- first')).toBe('first');
    expect(stripMarkdown('* second')).toBe('second');
    expect(stripMarkdown('1. step one')).toBe('step one');
  });
  it('strips bold, italic, and inline code', () => {
    expect(stripMarkdown('**bold** text')).toBe('bold text');
    expect(stripMarkdown('*italic* text')).toBe('italic text');
    expect(stripMarkdown('`code` block')).toBe('code block');
  });
  it('drops horizontal rules', () => {
    expect(stripMarkdown('above\n---\nbelow')).toBe('above\nbelow');
    expect(stripMarkdown('above\n***\nbelow')).toBe('above\nbelow');
  });
  it('collapses 3+ blank lines to one blank line', () => {
    expect(stripMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('returns empty string for non-string input', () => {
    expect(stripMarkdown(null)).toBe('');
    expect(stripMarkdown(undefined)).toBe('');
    expect(stripMarkdown(42)).toBe('');
  });
});

describe('extractFindings', () => {
  it('returns no findings when no header is present', () => {
    const result = extractFindings('Just a plain summary.');
    expect(result.findings).toEqual([]);
    expect(result.rest).toBe('Just a plain summary.');
  });

  it('extracts findings from a ## Findings block', () => {
    const summary = `Summary text.

## Findings
- **Bug #1** — Login accepts empty password
- **Minor** — Counter padding inconsistent`;
    const { findings, rest } = extractFindings(summary);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      severity: 'bug',
      marker: 'Bug #1',
      text: 'Login accepts empty password',
    });
    expect(findings[1]).toEqual({
      severity: 'minor',
      marker: 'Minor',
      text: 'Counter padding inconsistent',
    });
    expect(rest).toBe('Summary text.');
  });

  it('handles ### Findings (3-deep header)', () => {
    const summary = `### Findings
- **Bug** — broken`;
    const { findings } = extractFindings(summary);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('bug');
  });

  it('handles list items without a bold marker', () => {
    const { findings } = extractFindings('## Findings\n- Just a plain note');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      severity: 'info',
      marker: null,
      text: 'Just a plain note',
    });
  });

  it('stops at the next ATX heading', () => {
    const summary = `## Findings
- **Bug** — A

## Next Section
- not a finding`;
    const { findings, rest } = extractFindings(summary);
    expect(findings).toHaveLength(1);
    expect(rest).toBe(null); // no content before the findings header
  });

  it('returns no findings when the header has no list items', () => {
    const { findings, rest } = extractFindings('Body\n## Findings\n\n');
    expect(findings).toEqual([]);
    expect(rest).toBe('Body\n## Findings\n\n'); // unchanged when no items
  });
});

describe('groupMessages', () => {
  it('promotes ai text to the next group title', () => {
    const messages = [
      { kind: 'user', text: 'do it' },
      { kind: 'ai', text: 'Open the login form' },
      { kind: 'step', tool: 'browser_click', input: { selector: '#login' } },
      { kind: 'step', tool: 'browser_type', input: { text: 'hi' } },
    ];
    const groups = groupMessages(messages, true);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ kind: 'user', text: 'do it' });
    expect(groups[1].kind).toBe('group');
    expect(groups[1].title).toBe('Open the login form');
    expect(groups[1].steps).toHaveLength(2);
    expect(groups[1].status).toBe('running');
  });

  it('keeps noteworthy ai text as a standalone bubble when not promoted', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'ai', text: 'Found a bug in the form' },
      { kind: 'user', text: 'p2' }, // new turn, pending text needs to flush
    ];
    const groups = groupMessages(messages, false);
    // user, ai (noteworthy: 'found' / 'bug'), user
    expect(groups.map(g => g.kind)).toEqual(['user', 'ai', 'user']);
    expect(groups[1].text).toBe('Found a bug in the form');
  });

  it('drops mundane ai narration silently', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'ai', text: 'Let me take a snapshot first' },
      { kind: 'user', text: 'p2' },
    ];
    const groups = groupMessages(messages, false);
    expect(groups.map(g => g.kind)).toEqual(['user', 'user']);
  });

  it('hides the Skill tool entirely', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'Skill', input: { skill: 'verify' } },
      { kind: 'step', tool: 'browser_snapshot', input: {} },
    ];
    const groups = groupMessages(messages, true);
    expect(groups).toHaveLength(2); // user, group
    const group = groups[1];
    expect(group.kind).toBe('group');
    expect(group.steps).toHaveLength(1);
    expect(group.steps[0].tool).toBe('browser_snapshot');
  });

  it('splits the group when a boundary tool arrives', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'ai', text: 'first chapter' },
      { kind: 'step', tool: 'browser_click', input: {} },
      { kind: 'ai', text: 'second chapter' },
      { kind: 'step', tool: 'browser_navigate', input: { url: '/x' } },
    ];
    const groups = groupMessages(messages, true);
    // user, group(first chapter, 1 step), group(second chapter, 1 step running)
    expect(groups.map(g => g.kind)).toEqual(['user', 'group', 'group']);
    expect(groups[1].title).toBe('first chapter');
    expect(groups[1].steps).toHaveLength(1);
    expect(groups[1].status).toBe('ok');
    expect(groups[2].title).toBe('second chapter');
    expect(groups[2].steps).toHaveLength(1);
    expect(groups[2].status).toBe('running');
  });

  it('splits the group when MAX_TOOLS_PER_GROUP is hit', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'ai', text: 'doing stuff' },
      ...Array.from({ length: MAX_TOOLS_PER_GROUP + 2 }, () => ({
        kind: 'step', tool: 'browser_click', input: {},
      })),
    ];
    const groups = groupMessages(messages, true);
    // user, group(6 steps, ok), group(2 steps, running)
    expect(groups.map(g => g.kind)).toEqual(['user', 'group', 'group']);
    expect(groups[1].steps).toHaveLength(MAX_TOOLS_PER_GROUP);
    expect(groups[1].status).toBe('ok');
    expect(groups[2].steps).toHaveLength(2);
    expect(groups[2].status).toBe('running');
  });

  it('emits a report card on done with the agent summary', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'browser_click', input: {} },
      { kind: 'done', summary: '## Verification\n\nAll PASS', turns: 5, costUsd: 0.12 },
    ];
    const groups = groupMessages(messages, false);
    expect(groups.map(g => g.kind)).toEqual(['user', 'group', 'report']);
    expect(groups[1].status).toBe('ok'); // closed by done
    expect(groups[2]).toMatchObject({
      kind: 'report',
      isError: false,
      turns: 5,
      costUsd: 0.12,
      saveable: true,
      source: 'agent',
    });
    // Markdown stripped — no '##' in the report text
    expect(groups[2].text).not.toContain('##');
    expect(groups[2].text).toContain('Verification');
    expect(groups[2].text).toContain('All PASS');
  });

  it('threads the done.source field through to the report card', () => {
    const messages = [
      { kind: 'user', text: '(recording manual interactions)' },
      { kind: 'step', tool: 'browser_click', input: {} },
      { kind: 'done', source: 'recording', turns: 1, costUsd: 0, summary: 'Recorded 1 action.' },
    ];
    const groups = groupMessages(messages, false);
    expect(groups.find(g => g.kind === 'report')).toMatchObject({
      kind: 'report',
      source: 'recording',
    });
  });

  it('emits a findings card alongside the report when the summary has a Findings block', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'browser_click', input: {} },
      {
        kind: 'done',
        summary: 'Tested.\n\n## Findings\n- **Bug** — broken\n- **Minor** — small',
        turns: 3,
        costUsd: 0.05,
      },
    ];
    const groups = groupMessages(messages, false);
    expect(groups.map(g => g.kind)).toEqual(['user', 'group', 'report', 'findings']);
    expect(groups[3].findings).toHaveLength(2);
    expect(groups[3].findings[0].severity).toBe('bug');
    expect(groups[3].findings[1].severity).toBe('minor');
    // Findings block stripped from the report body
    expect(groups[2].text).not.toContain('Findings');
    expect(groups[2].text).toContain('Tested');
  });

  it('marks an open group as running when the stream is live', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'browser_snapshot', input: {} },
    ];
    const liveGroups = groupMessages(messages, true);
    expect(liveGroups[1].status).toBe('running');
    const finishedGroups = groupMessages(messages, false);
    expect(finishedGroups[1].status).toBe('ok');
  });

  it('marks the group as errored only when the session-level done is an error', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'browser_click', input: {} },
      { kind: 'done', summary: '', isError: true },
    ];
    const groups = groupMessages(messages, false);
    expect(groups[1].status).toBe('error');
  });

  it('keeps the group green when individual tool retries failed but the session succeeded', () => {
    // The agent typically retries a selector / approach before landing
    // the intended interaction. Those tool-level errors are diagnostic
    // detail (still rendered in the expanded view via step.isError),
    // not a business-level failure signal. The group should stay green
    // as long as the session-level done is non-error.
    const messages = [
      { kind: 'user', text: 'click the submit button' },
      { kind: 'ai', text: 'Locating the submit button.' },
      { kind: 'step', tool: 'mcp__playwright__browser_click', input: { ref: 'e12' }, isError: true },
      { kind: 'step', tool: 'mcp__playwright__browser_snapshot', input: {} },
      { kind: 'step', tool: 'mcp__playwright__browser_click', input: { ref: 'e7' } },
      { kind: 'done', summary: 'Submit clicked.', isError: false },
    ];
    const groups = groupMessages(messages, false);
    const group = groups.find(g => g.kind === 'group');
    expect(group).toBeDefined();
    expect(group.status).toBe('ok');
    // step-level error info preserved for the expanded diagnostic view
    expect(group.steps[0].isError).toBe(true);
    expect(group.steps[1].isError).toBe(false);
    expect(group.steps[2].isError).toBe(false);
  });

  it('marks a user-cancelled run as cancelled, not error', () => {
    // User pressed Stop mid-run. service.ts emits session_end with
    // cancelled: true, isError: false. The agent didn't fail — the
    // user chose to stop — so the group + report should render
    // neutral (grey ⊘ "Stopped"), not red (✗ "Failed"). The run is
    // also not saveable as a spec since it didn't complete.
    const messages = [
      { kind: 'user', text: 'do something long' },
      { kind: 'ai', text: 'Starting the long task.' },
      { kind: 'step', tool: 'browser_snapshot', input: {} },
      { kind: 'done', summary: 'cancelled by user', cancelled: true, isError: false, costUsd: 0.05 },
    ];
    const groups = groupMessages(messages, false);
    const group = groups.find(g => g.kind === 'group');
    const report = groups.find(g => g.kind === 'report');
    expect(group).toBeDefined();
    expect(group.status).toBe('cancelled');
    expect(report).toBeDefined();
    expect(report.cancelled).toBe(true);
    expect(report.isError).toBe(false);
    expect(report.saveable).toBe(false);
  });

  it('does not expose the legacy `errored` field on closed groups', () => {
    // Regression: previously the reducer accumulated an `open.errored`
    // boolean that escalated tool-level isError to a red group. With the
    // new business-view semantics there is no per-group error
    // accumulator at all.
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'browser_click', input: {}, isError: true },
      { kind: 'done', summary: '', isError: false },
    ];
    const groups = groupMessages(messages, false);
    const group = groups.find(g => g.kind === 'group');
    expect(group).toBeDefined();
    expect(group.errored).toBeUndefined();
  });

  it('falls back to a tool-derived title when no ai text precedes the step', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'step', tool: 'browser_click', input: { selector: '#submit-btn' } },
    ];
    const groups = groupMessages(messages, false);
    expect(groups[1].title).toContain('browser_click');
    expect(groups[1].title).toContain('#submit-btn');
  });

  it('emits a report card on done even when there is no open group', () => {
    const messages = [
      { kind: 'user', text: 'p' },
      { kind: 'done', summary: 'just a verdict', turns: 1, costUsd: 0.01 },
    ];
    const groups = groupMessages(messages, false);
    expect(groups.map(g => g.kind)).toEqual(['user', 'report']);
  });
});

describe('constants integrity', () => {
  it('NOTEWORTHY_AI matches expected severity words', () => {
    expect(NOTEWORTHY_AI.test('I found a bug')).toBe(true);
    expect(NOTEWORTHY_AI.test('There is an error')).toBe(true);
    expect(NOTEWORTHY_AI.test('The page loaded')).toBe(false);
  });
  it('HIDDEN_TOOLS contains Skill', () => {
    expect(HIDDEN_TOOLS.has('Skill')).toBe(true);
  });
  it('BOUNDARY_TOOLS contains navigate / fill_form', () => {
    expect(BOUNDARY_TOOLS.has('browser_navigate')).toBe(true);
    expect(BOUNDARY_TOOLS.has('browser_fill_form')).toBe(true);
  });
  it('MAX_TOOLS_PER_GROUP is a positive integer', () => {
    expect(Number.isInteger(MAX_TOOLS_PER_GROUP)).toBe(true);
    expect(MAX_TOOLS_PER_GROUP).toBeGreaterThan(0);
  });
});
