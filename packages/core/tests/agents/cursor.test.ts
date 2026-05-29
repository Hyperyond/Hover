import { describe, it, expect } from 'vitest';
import { cursorAgent, __testing } from '../../src/agents/cursor.js';
import type { InvokeEvent } from '../../src/agents/types.js';

describe('cursorAgent metadata', () => {
  it('declares soft sandbox + json-lines stream + argv protocol', () => {
    expect(cursorAgent.id).toBe('cursor');
    expect(cursorAgent.binName).toBe('cursor-agent');
    expect(cursorAgent.protocol).toBe('argv');
    expect(cursorAgent.streamFormat).toBe('json-lines');
    expect(cursorAgent.sandboxStrength).toBe('soft');
    expect(cursorAgent.display.label).toBe('Cursor');
    // The install hint should be the documented installer; we don't pin the
    // exact URL but at minimum it should mention cursor.com/install.
    expect(cursorAgent.display.installHint).toContain('cursor.com/install');
  });
});

describe('cursorAgent.buildArgs', () => {
  it('uses -p with a prompt that prefixes the HOVER-mode preface, plus stream-json + --force', () => {
    const argv = cursorAgent.buildArgs({ agentId: 'cursor', prompt: 'do a thing' });
    expect(argv[0]).toBe('-p');
    // The prompt is the second positional, with the preface prepended.
    expect(typeof argv[1]).toBe('string');
    expect(argv[1]).toMatch(/mcp__playwright/);
    expect(argv[1]).toContain('do a thing');
    expect(argv).toContain('--output-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--force');
  });

  it('appends --resume <id> only when a session id is provided', () => {
    const noResume = cursorAgent.buildArgs({ agentId: 'cursor', prompt: 'p' });
    expect(noResume).not.toContain('--resume');

    const withResume = cursorAgent.buildArgs({
      agentId: 'cursor',
      prompt: 'p',
      sessionId: 'chat-xyz',
    });
    const idx = withResume.indexOf('--resume');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(withResume[idx + 1]).toBe('chat-xyz');
  });

  it('forwards model selection with --model', () => {
    const argv = cursorAgent.buildArgs({
      agentId: 'cursor',
      prompt: 'p',
      model: 'sonnet-4',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('sonnet-4');
  });

  it('folds appendSystemPrompt into the preface prepended to the user prompt', () => {
    const argv = cursorAgent.buildArgs({
      agentId: 'cursor',
      prompt: 'the user task',
      appendSystemPrompt: 'user is already on http://localhost:5173/',
    });
    const prompt = argv[1]!;
    expect(prompt).toContain('mcp__playwright'); // baseline preface preserved
    expect(prompt).toContain('user is already on http://localhost:5173/');
    expect(prompt).toContain('the user task');
    // Order: preface, then user prompt.
    expect(prompt.indexOf('mcp__playwright')).toBeLessThan(prompt.indexOf('the user task'));
    expect(prompt.indexOf('user is already on')).toBeLessThan(prompt.indexOf('the user task'));
  });

  it('does NOT emit Claude-specific or codex-specific flags Cursor does not understand', () => {
    const argv = cursorAgent.buildArgs({
      agentId: 'cursor',
      prompt: 'p',
      allowedTools: ['mcp__playwright'],
      disallowedTools: ['Bash'],
      mcpConfig: '/tmp/mcp.json',
      maxBudgetUsd: 0.5,
    });
    expect(argv).not.toContain('--allowedTools');
    expect(argv).not.toContain('--disallowedTools');
    expect(argv).not.toContain('--mcp-config');
    expect(argv).not.toContain('--strict-mcp-config');
    expect(argv).not.toContain('--max-budget-usd');
    expect(argv).not.toContain('--append-system-prompt');
    // codex-specific:
    expect(argv).not.toContain('--sandbox');
    expect(argv).not.toContain('--ask-for-approval');
    expect(argv).not.toContain('-c');
  });
});

describe('cursorAgent.parseEvent', () => {
  it('emits session_start on system/init', () => {
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        model: 'sonnet-4',
      }),
    );
    expect(events).toEqual([
      { kind: 'session_start', sessionId: 'sess-1', model: 'sonnet-4' },
    ]);
  });

  it('emits tool_use on tool_call/started, stripping the mcp__playwright__ prefix from MCP calls', () => {
    const state = __testing.freshState();
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: {
          mcpToolCall: {
            tool: 'mcp__playwright__browser_click',
            input: { selector: '#go' },
          },
        },
      }),
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'tool_use',
      tool: 'browser_click',
      input: { selector: '#go' },
    });
  });

  it('emits tool_use on tool_call/started for built-in shell calls (kind from wrapper key)', () => {
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c2',
        tool_call: { shellToolCall: { command: 'ls' } },
      }),
    );
    expect(events).toHaveLength(1);
    if (events[0]!.kind === 'tool_use') {
      expect(events[0]!.tool).toBe('shell');
    }
  });

  it('emits tool_result on tool_call/completed and detects is_error', () => {
    const ok = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'c1',
        tool_call: { mcpToolCall: { status: 'ok' } },
      }),
    );
    expect(ok).toEqual([{ kind: 'tool_result', isError: false }]);

    const bad = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'c2',
        tool_call: { shellToolCall: { status: 'error', is_error: true } },
      }),
    );
    expect(bad).toEqual([{ kind: 'tool_result', isError: true }]);
  });

  it('emits usage (turns only, no cost) plus text on assistant events', () => {
    const state = __testing.freshState();
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello there' }],
        },
      }),
      state,
    );
    // First entry is the usage / turn-counter advance.
    expect(events[0]).toEqual({ kind: 'usage', turns: 1 });
    // Second is the text block.
    expect(events[1]).toEqual({ kind: 'text', text: 'hello there' });
  });

  it('drops empty/whitespace-only text blocks but still bumps the turn counter', () => {
    const state = __testing.freshState();
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '   ' }] },
      }),
      state,
    );
    expect(events).toEqual([{ kind: 'usage', turns: 1 }]);
  });

  it('emits session_end on result events (no cost — Cursor does not publish it)', () => {
    const state = __testing.freshState();
    cursorAgent.parseEvent(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 's',
        model: 'sonnet-4',
      }),
      state,
    );
    cursorAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'done' }] },
      }),
      state,
    );
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        duration_ms: 1234,
        is_error: false,
        result: 'finished',
        session_id: 's',
      }),
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'session_end',
      turns: 1,
      isError: false,
      summary: 'finished',
    });
    // Cost is intentionally absent — we don't fabricate.
    if (events[0]!.kind === 'session_end') {
      expect(events[0]!.costUsd).toBeUndefined();
    }
  });

  it('flags isError on result events whose subtype names an error', () => {
    const events = cursorAgent.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'error_tool_limit',
        duration_ms: 100,
        is_error: false, // simulate Cursor only setting subtype, not is_error
      }),
    );
    if (events[0]!.kind === 'session_end') {
      expect(events[0]!.isError).toBe(true);
    }
  });

  it('falls back to a raw event on non-JSON lines and [] on blanks', () => {
    expect(cursorAgent.parseEvent('not json')).toEqual([{ kind: 'raw', line: 'not json' }]);
    expect(cursorAgent.parseEvent('')).toEqual([]);
    expect(cursorAgent.parseEvent('   ')).toEqual([]);
  });
});

describe('cursorAgent.onStreamEnd', () => {
  it('synthesizes session_end with the last assistant text when no result event arrived', () => {
    const state = __testing.freshState();
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'sonnet-4' }),
      state,
    );
    cursorAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'wrapped up' }] },
      }),
      state,
    );

    const end = cursorAgent.onStreamEnd!(0, state) as InvokeEvent;
    expect(end.kind).toBe('session_end');
    if (end.kind === 'session_end') {
      expect(end.summary).toBe('wrapped up');
      expect(end.turns).toBe(1);
      expect(end.isError).toBe(false);
      // No fabricated cost.
      expect(end.costUsd).toBeUndefined();
    }
  });

  it('flags isError when the child exits non-zero', () => {
    const state = __testing.freshState();
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
      state,
    );
    const end = cursorAgent.onStreamEnd!(1, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('two concurrent parser states do not interfere', () => {
    const a = __testing.freshState();
    const b = __testing.freshState();
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'A' }),
      a,
    );
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'B' }),
      b,
    );
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }),
      a,
    );
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'y' }] } }),
      b,
    );
    cursorAgent.parseEvent(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'z' }] } }),
      a,
    );
    const sa = __testing.getState(a);
    const sb = __testing.getState(b);
    expect(sa.runningTurns).toBe(2);
    expect(sb.runningTurns).toBe(1);
    expect(sa.runningSessionId).toBe('A');
    expect(sb.runningSessionId).toBe('B');
  });
});
