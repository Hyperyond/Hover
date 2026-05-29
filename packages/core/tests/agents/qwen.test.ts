import { describe, it, expect } from 'vitest';
import { qwenAgent, __testing } from '../../src/agents/qwen.js';
import type { InvokeEvent } from '../../src/agents/types.js';

describe('qwenAgent metadata', () => {
  it('declares soft sandbox + json-lines stream + argv protocol', () => {
    expect(qwenAgent.id).toBe('qwen');
    expect(qwenAgent.binName).toBe('qwen');
    expect(qwenAgent.protocol).toBe('argv');
    expect(qwenAgent.streamFormat).toBe('json-lines');
    expect(qwenAgent.sandboxStrength).toBe('soft');
    expect(qwenAgent.display.label).toBe('Qwen Code');
    expect(qwenAgent.display.installHint).toContain('@qwen-code/qwen-code');
  });
});

describe('qwenAgent.buildArgs', () => {
  it('uses -p with the user prompt and emits --output-format stream-json + --approval-mode yolo', () => {
    const argv = qwenAgent.buildArgs({ agentId: 'qwen', prompt: 'do a thing' });
    expect(argv[0]).toBe('-p');
    expect(argv[1]).toBe('do a thing');
    expect(argv).toContain('--output-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--approval-mode');
    expect(argv).toContain('yolo');
  });

  it('uses the native --append-system-prompt flag (not prompt prepending)', () => {
    const argv = qwenAgent.buildArgs({ agentId: 'qwen', prompt: 'do a thing' });
    const idx = argv.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(argv[idx + 1]).toContain('mcp__playwright');
    // The user prompt should remain clean — the preface should not have been
    // prepended to it like in cursor / aider / gemini.
    expect(argv[1]).toBe('do a thing');
    expect(argv[1]).not.toContain('mcp__playwright');
  });

  it('appends --resume <id> only when a session id is provided', () => {
    const noResume = qwenAgent.buildArgs({ agentId: 'qwen', prompt: 'p' });
    expect(noResume).not.toContain('--resume');
    expect(noResume).not.toContain('--continue');

    const withResume = qwenAgent.buildArgs({
      agentId: 'qwen',
      prompt: 'p',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
    });
    const idx = withResume.indexOf('--resume');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(withResume[idx + 1]).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('forwards model selection with --model', () => {
    const argv = qwenAgent.buildArgs({
      agentId: 'qwen',
      prompt: 'p',
      model: 'qwen3-coder-plus',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('qwen3-coder-plus');
  });

  it('folds appendSystemPrompt into the --append-system-prompt payload', () => {
    const argv = qwenAgent.buildArgs({
      agentId: 'qwen',
      prompt: 'the user task',
      appendSystemPrompt: 'user is already on http://localhost:5173/',
    });
    const idx = argv.indexOf('--append-system-prompt');
    const sys = argv[idx + 1]!;
    expect(sys).toContain('mcp__playwright');
    expect(sys).toContain('user is already on http://localhost:5173/');
    // The user prompt is independent — it doesn't carry the caller-supplied
    // text, only the system prompt does.
    expect(argv[1]).toBe('the user task');
  });

  it('does NOT emit Claude-specific or codex-specific flags qwen does not understand', () => {
    const argv = qwenAgent.buildArgs({
      agentId: 'qwen',
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
    expect(argv).not.toContain('-c');
    expect(argv).not.toContain('--force');
  });
});

describe('qwenAgent.parseEvent', () => {
  it('emits session_start on system/session_start', () => {
    const events = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'system',
        subtype: 'session_start',
        uuid: 'abc',
        session_id: 'sess-1',
        model: 'qwen3-coder-plus',
      }),
    );
    expect(events).toEqual([
      { kind: 'session_start', sessionId: 'sess-1', model: 'qwen3-coder-plus' },
    ]);
  });

  it('emits usage + text on assistant events with a text content block', () => {
    const state = __testing.freshState();
    const events = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        session_id: 's',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello there' }],
        },
      }),
      state,
    );
    expect(events[0]).toEqual({ kind: 'usage', turns: 1 });
    expect(events[1]).toEqual({ kind: 'text', text: 'hello there' });
  });

  it('emits tool_use on assistant events with a tool_use content block, stripping mcp__playwright__', () => {
    const state = __testing.freshState();
    const events = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        session_id: 's',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'mcp__playwright__browser_click',
              input: { selector: '#go' },
            },
          ],
        },
      }),
      state,
    );
    // First entry is the usage / turn-counter advance.
    expect(events[0]).toEqual({ kind: 'usage', turns: 1 });
    expect(events[1]).toMatchObject({
      kind: 'tool_use',
      tool: 'browser_click',
      input: { selector: '#go' },
    });
  });

  it('emits tool_result on user messages whose content carries a tool_result block', () => {
    const ok = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'user',
        session_id: 's',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: 'ok' },
          ],
        },
      }),
    );
    expect(ok).toEqual([{ kind: 'tool_result', isError: false }]);

    const bad = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'user',
        session_id: 's',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-2', is_error: true, content: 'fail' },
          ],
        },
      }),
    );
    expect(bad).toEqual([{ kind: 'tool_result', isError: true }]);
  });

  it('drops empty / whitespace-only text blocks but still bumps the turn counter', () => {
    const state = __testing.freshState();
    const events = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
      }),
      state,
    );
    expect(events).toEqual([{ kind: 'usage', turns: 1 }]);
  });

  it('emits session_end on result events (no cost — qwen does not publish USD)', () => {
    const state = __testing.freshState();
    qwenAgent.parseEvent(
      JSON.stringify({
        type: 'system',
        subtype: 'session_start',
        session_id: 's',
        model: 'qwen3-coder-plus',
      }),
      state,
    );
    qwenAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      }),
      state,
    );
    const events = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 's',
        is_error: false,
        duration_ms: 1234,
        result: 'finished',
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
    if (events[0]!.kind === 'session_end') {
      expect(events[0]!.costUsd).toBeUndefined();
    }
  });

  it('flags isError on result events whose subtype names an error', () => {
    const events = qwenAgent.parseEvent(
      JSON.stringify({
        type: 'result',
        subtype: 'error_tool_limit',
        is_error: false, // simulate qwen only setting subtype
      }),
    );
    if (events[0]!.kind === 'session_end') {
      expect(events[0]!.isError).toBe(true);
    }
  });

  it('falls back to a raw event on non-JSON lines and [] on blanks', () => {
    expect(qwenAgent.parseEvent('not json')).toEqual([{ kind: 'raw', line: 'not json' }]);
    expect(qwenAgent.parseEvent('')).toEqual([]);
    expect(qwenAgent.parseEvent('   ')).toEqual([]);
  });
});

describe('qwenAgent.onStreamEnd', () => {
  it('synthesizes session_end with the last assistant text when no result event arrived', () => {
    const state = __testing.freshState();
    qwenAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'session_start', session_id: 's', model: 'qwen3' }),
      state,
    );
    qwenAgent.parseEvent(
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'wrapped up' }] },
      }),
      state,
    );

    const end = qwenAgent.onStreamEnd!(0, state) as InvokeEvent;
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
    qwenAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'session_start', session_id: 's' }),
      state,
    );
    const end = qwenAgent.onStreamEnd!(1, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('two concurrent parser states do not interfere', () => {
    const a = __testing.freshState();
    const b = __testing.freshState();
    qwenAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'session_start', session_id: 'A' }),
      a,
    );
    qwenAgent.parseEvent(
      JSON.stringify({ type: 'system', subtype: 'session_start', session_id: 'B' }),
      b,
    );
    qwenAgent.parseEvent(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }] } }),
      a,
    );
    qwenAgent.parseEvent(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'y' }] } }),
      b,
    );
    qwenAgent.parseEvent(
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
