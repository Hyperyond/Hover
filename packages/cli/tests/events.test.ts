import { describe, expect, it } from 'vitest';
import type { InvokeEvent } from '@hover-dev/core';
import { createEventMapper, describeTool } from '../src/engine/events.js';

describe('describeTool', () => {
  it('renders grounded control actuations readably', () => {
    expect(describeTool('mcp__hovercontrol__click_control', { name: 'Sign in' })).toBe('click "Sign in"');
    expect(describeTool('mcp__hovercontrol__select_control', { name: 'Country' })).toBe('select "Country"');
    expect(describeTool('mcp__hovercontrol__check_control', { name: 'Agree', checked: false })).toBe('uncheck "Agree"');
    expect(describeTool('mcp__hovercontrol__check_control', { name: 'Agree' })).toBe('check "Agree"');
    expect(describeTool('mcp__hovercontrol__assert_visible', { text: 'Welcome' })).toBe('assert "Welcome" visible');
  });

  it('never echoes the typed value for a fill (could be a credential)', () => {
    const out = describeTool('mcp__hovercontrol__fill_control', { name: 'Password', value: 'hunter2' });
    expect(out).toBe('fill "Password"');
    expect(out).not.toContain('hunter2');
  });

  it('renders playwright navigation/snapshot tools', () => {
    expect(describeTool('mcp__playwright__browser_navigate', { url: 'http://localhost:5173' })).toBe(
      'navigate → http://localhost:5173',
    );
    expect(describeTool('browser_snapshot', {})).toBe('read page');
    expect(describeTool('mcp__playwright__browser_tabs', { action: 'list' })).toBe('tabs (list)');
  });

  it('falls back to the bare tool name for unknown tools', () => {
    expect(describeTool('mcp__playwright__browser_wait_for', { time: 1 })).toBe('browser_wait_for');
    expect(describeTool('some_raw_tool', {})).toBe('some_raw_tool');
  });

  it('truncates long targets', () => {
    const long = 'x'.repeat(80);
    expect(describeTool('mcp__hovercontrol__click_control', { name: long })).toMatch(/^click "x{47}…"$/);
  });
});

describe('createEventMapper', () => {
  const run = (evs: InvokeEvent[]) => {
    const map = createEventMapper();
    return evs.map(map).filter(Boolean);
  };

  it('maps the lifecycle into stream lines and drops noise', () => {
    const lines = run([
      { kind: 'session_start', sessionId: 'abcdef12', model: 'sonnet' },
      { kind: 'mcp_status', server: 'playwright', status: 'connected' },
      { kind: 'text', text: '  Exploring the app.  ' },
      { kind: 'text', text: '   ' }, // empty → dropped
      { kind: 'tool_use', tool: 'mcp__hovercontrol__click_control', input: { name: 'Sign in' } },
      { kind: 'tool_result', isError: false, preview: 'ok' }, // clean → dropped
      { kind: 'tool_result', isError: true, preview: 'boom' },
      { kind: 'usage', costUsd: 0.01 }, // dropped
      { kind: 'raw', line: 'noise' }, // dropped
      { kind: 'session_end', isError: false, summary: 'all good' },
    ]);

    expect(lines.map((l) => l && `${l.kind}:${l.text}`)).toEqual([
      'info:session started · sonnet',
      'info:playwright: connected',
      'narration:Exploring the app.',
      'tool:click "Sign in"',
      'error:boom',
      'info:all good',
    ]);
  });

  it('marks a cancelled / errored session_end appropriately', () => {
    const map = createEventMapper();
    expect(map({ kind: 'session_end', cancelled: true })?.text).toBe('cancelled');
    expect(map({ kind: 'session_end', isError: true })?.kind).toBe('error');
  });
});
