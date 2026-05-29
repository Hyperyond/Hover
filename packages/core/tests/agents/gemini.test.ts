import { describe, it, expect } from 'vitest';
import { geminiAgent, __testing } from '../../src/agents/gemini.js';
import type { InvokeEvent } from '../../src/agents/types.js';

describe('geminiAgent metadata', () => {
  it('declares soft sandbox + json-lines stream + argv protocol', () => {
    expect(geminiAgent.id).toBe('gemini');
    expect(geminiAgent.binName).toBe('gemini');
    expect(geminiAgent.protocol).toBe('argv');
    expect(geminiAgent.streamFormat).toBe('json-lines');
    expect(geminiAgent.sandboxStrength).toBe('soft');
    expect(geminiAgent.display.label).toBe('Gemini');
    expect(geminiAgent.display.installHint).toContain('@google/gemini-cli');
  });
});

describe('geminiAgent.buildArgs', () => {
  it('uses -p with the HOVER-mode preface prepended to the prompt, plus --output-format stream-json + --approval-mode yolo', () => {
    const argv = geminiAgent.buildArgs({ agentId: 'gemini', prompt: 'do a thing' });
    expect(argv[0]).toBe('-p');
    expect(typeof argv[1]).toBe('string');
    expect(argv[1]).toMatch(/mcp__playwright/);
    expect(argv[1]).toContain('do a thing');
    expect(argv).toContain('--output-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--approval-mode');
    expect(argv).toContain('yolo');
  });

  it('appends --resume <id> only when a session id is provided', () => {
    const noResume = geminiAgent.buildArgs({ agentId: 'gemini', prompt: 'p' });
    expect(noResume).not.toContain('--resume');

    const withResume = geminiAgent.buildArgs({
      agentId: 'gemini',
      prompt: 'p',
      sessionId: 'gem-session-123',
    });
    const idx = withResume.indexOf('--resume');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(withResume[idx + 1]).toBe('gem-session-123');
  });

  it('forwards model selection with --model', () => {
    const argv = geminiAgent.buildArgs({
      agentId: 'gemini',
      prompt: 'p',
      model: 'gemini-2.5-pro',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('gemini-2.5-pro');
  });

  it('folds appendSystemPrompt into the preface prepended to the user prompt (no --append-system-prompt flag exists in gemini-cli)', () => {
    const argv = geminiAgent.buildArgs({
      agentId: 'gemini',
      prompt: 'the user task',
      appendSystemPrompt: 'user is already on http://localhost:5173/',
    });
    const prompt = argv[1]!;
    expect(prompt).toContain('mcp__playwright');
    expect(prompt).toContain('user is already on http://localhost:5173/');
    expect(prompt).toContain('the user task');
    expect(prompt.indexOf('mcp__playwright')).toBeLessThan(prompt.indexOf('the user task'));
    // gemini-cli has no --append-system-prompt flag, so we must NOT pass it.
    expect(argv).not.toContain('--append-system-prompt');
    expect(argv).not.toContain('--system-prompt');
  });

  it('does NOT emit Claude-specific or codex-specific flags gemini does not understand', () => {
    const argv = geminiAgent.buildArgs({
      agentId: 'gemini',
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
    expect(argv).not.toContain('--sandbox');
    expect(argv).not.toContain('--ask-for-approval');
    expect(argv).not.toContain('--force');
    expect(argv).not.toContain('-c');
  });
});

describe('geminiAgent.parseEvent', () => {
  it('emits session_start on init events', () => {
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'init',
        session_id: 'sess-1',
        model: 'gemini-2.5-pro',
      }),
    );
    expect(events).toEqual([
      { kind: 'session_start', sessionId: 'sess-1', model: 'gemini-2.5-pro' },
    ]);
  });

  it('emits usage + text on message events with string content', () => {
    const state = __testing.freshState();
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: 'hello there',
      }),
      state,
    );
    expect(events[0]).toEqual({ kind: 'usage', turns: 1 });
    expect(events[1]).toEqual({ kind: 'text', text: 'hello there' });
  });

  it('emits usage + text on message events with array content (text blocks)', () => {
    const state = __testing.freshState();
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'first part' },
          { type: 'text', text: 'second part' },
        ],
      }),
      state,
    );
    expect(events[0]).toEqual({ kind: 'usage', turns: 1 });
    expect(events[1]).toEqual({ kind: 'text', text: 'first part\nsecond part' });
  });

  it('does NOT bump turns or emit text for role:user message echoes', () => {
    const state = __testing.freshState();
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'message',
        role: 'user',
        content: 'the user prompt',
      }),
      state,
    );
    expect(events).toEqual([]);
    expect(__testing.getState(state).runningTurns).toBe(0);
  });

  it('emits tool_use on tool_use events, stripping the mcp__playwright__ prefix', () => {
    const state = __testing.freshState();
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'tool_use',
        id: 't1',
        name: 'mcp__playwright__browser_click',
        input: { selector: '#go' },
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

  it('emits tool_result on tool_result events and detects is_error', () => {
    const ok = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'tool_result',
        tool_use_id: 't1',
        is_error: false,
      }),
    );
    expect(ok).toEqual([{ kind: 'tool_result', isError: false }]);

    const bad = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'tool_result',
        tool_use_id: 't2',
        is_error: true,
      }),
    );
    expect(bad).toEqual([{ kind: 'tool_result', isError: true }]);
  });

  it('emits session_end on result events using stats.turns when present', () => {
    const state = __testing.freshState();
    geminiAgent.parseEvent(
      JSON.stringify({ type: 'init', session_id: 's', model: 'gemini-2.5-pro' }),
      state,
    );
    geminiAgent.parseEvent(
      JSON.stringify({ type: 'message', role: 'assistant', content: 'done' }),
      state,
    );
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'result',
        response: 'finished',
        stats: { duration_ms: 1234, turns: 5 },
      }),
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'session_end',
      // stats.turns wins over the running turn counter.
      turns: 5,
      isError: false,
      summary: 'finished',
    });
    if (events[0]!.kind === 'session_end') {
      expect(events[0]!.costUsd).toBeUndefined();
    }
  });

  it('flags isError on result events that carry an error block', () => {
    const events = geminiAgent.parseEvent(
      JSON.stringify({
        type: 'result',
        response: null,
        stats: { duration_ms: 100 },
        error: { message: 'API failure' },
      }),
    );
    if (events[0]!.kind === 'session_end') {
      expect(events[0]!.isError).toBe(true);
    }
  });

  it('surfaces error events as text and records the error state', () => {
    const state = __testing.freshState();
    geminiAgent.parseEvent(JSON.stringify({ type: 'init', session_id: 's' }), state);
    const events = geminiAgent.parseEvent(
      JSON.stringify({ type: 'error', message: 'something went wrong' }),
      state,
    );
    expect(events.find(e => e.kind === 'text')).toBeDefined();
    expect(__testing.getState(state).sawErrorEvent).toBe(true);
  });

  it('falls back to a raw event on non-JSON lines and [] on blanks', () => {
    expect(geminiAgent.parseEvent('not json')).toEqual([{ kind: 'raw', line: 'not json' }]);
    expect(geminiAgent.parseEvent('')).toEqual([]);
    expect(geminiAgent.parseEvent('   ')).toEqual([]);
  });
});

describe('geminiAgent.onStreamEnd', () => {
  it('synthesizes session_end with the last assistant text when no result event arrived', () => {
    const state = __testing.freshState();
    geminiAgent.parseEvent(JSON.stringify({ type: 'init', session_id: 's' }), state);
    geminiAgent.parseEvent(
      JSON.stringify({ type: 'message', role: 'assistant', content: 'wrapped up' }),
      state,
    );

    const end = geminiAgent.onStreamEnd!(0, state) as InvokeEvent;
    expect(end.kind).toBe('session_end');
    if (end.kind === 'session_end') {
      expect(end.summary).toBe('wrapped up');
      expect(end.turns).toBe(1);
      expect(end.isError).toBe(false);
      expect(end.costUsd).toBeUndefined();
    }
  });

  it('flags isError when the child exits non-zero', () => {
    const state = __testing.freshState();
    geminiAgent.parseEvent(JSON.stringify({ type: 'init', session_id: 's' }), state);
    const end = geminiAgent.onStreamEnd!(1, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('two concurrent parser states do not interfere', () => {
    const a = __testing.freshState();
    const b = __testing.freshState();
    geminiAgent.parseEvent(JSON.stringify({ type: 'init', session_id: 'A' }), a);
    geminiAgent.parseEvent(JSON.stringify({ type: 'init', session_id: 'B' }), b);
    geminiAgent.parseEvent(
      JSON.stringify({ type: 'message', role: 'assistant', content: 'x' }),
      a,
    );
    geminiAgent.parseEvent(
      JSON.stringify({ type: 'message', role: 'assistant', content: 'y' }),
      b,
    );
    geminiAgent.parseEvent(
      JSON.stringify({ type: 'message', role: 'assistant', content: 'z' }),
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
