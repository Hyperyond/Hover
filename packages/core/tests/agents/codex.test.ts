import { describe, it, expect, beforeEach } from 'vitest';
import { codexAgent, __testing } from '../../src/agents/codex.js';
import type { InvokeEvent } from '../../src/agents/types.js';

describe('codexAgent metadata', () => {
  it('declares soft sandbox + json-lines stream + argv protocol', () => {
    expect(codexAgent.id).toBe('codex');
    expect(codexAgent.binName).toBe('codex');
    expect(codexAgent.protocol).toBe('argv');
    expect(codexAgent.streamFormat).toBe('json-lines');
    expect(codexAgent.sandboxStrength).toBe('soft');
    expect(codexAgent.apiKeyEnv).toBe('OPENAI_API_KEY');
    expect(codexAgent.display.label).toBe('OpenAI Codex');
    expect(codexAgent.display.installHint).toContain('@openai/codex');
  });
});

describe('codexAgent.buildArgs', () => {
  it('starts with `exec` and the prompt, with --json + dontAsk + read-only sandbox', () => {
    const argv = codexAgent.buildArgs({ agentId: 'codex', prompt: 'do a thing' });
    expect(argv[0]).toBe('exec');
    expect(argv).toContain('do a thing');
    expect(argv).toContain('--json');
    expect(argv).toContain('--ask-for-approval');
    expect(argv).toContain('never');
    expect(argv).toContain('--sandbox');
    expect(argv).toContain('read-only');
  });

  it('injects `resume <id>` before the prompt when sessionId is set', () => {
    const argv = codexAgent.buildArgs({
      agentId: 'codex',
      prompt: 'follow-up',
      sessionId: '01-99-abc',
    });
    // exec resume <id> <prompt>
    expect(argv.slice(0, 4)).toEqual(['exec', 'resume', '01-99-abc', 'follow-up']);
  });

  it('forwards model selection with --model', () => {
    const argv = codexAgent.buildArgs({
      agentId: 'codex',
      prompt: 'p',
      model: 'gpt-5.5',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('gpt-5.5');
  });

  it('emits a developer_instructions config override containing the MCP-only constraint', () => {
    const argv = codexAgent.buildArgs({ agentId: 'codex', prompt: 'p' });
    const dashCIndex = argv.indexOf('-c');
    expect(dashCIndex).toBeGreaterThanOrEqual(0);
    const setting = argv[dashCIndex + 1];
    expect(setting).toMatch(/^developer_instructions=/);
    expect(setting).toContain('mcp__playwright');
    // Quoted JSON so the shell doesn't fight us over special chars.
    const value = setting!.slice('developer_instructions='.length);
    expect(() => JSON.parse(value)).not.toThrow();
  });

  it('concatenates appendSystemPrompt into developer_instructions', () => {
    const argv = codexAgent.buildArgs({
      agentId: 'codex',
      prompt: 'p',
      appendSystemPrompt: 'user is already on http://localhost:5173/',
    });
    const dashCIndex = argv.indexOf('-c');
    const setting = argv[dashCIndex + 1]!;
    const value = JSON.parse(setting.slice('developer_instructions='.length));
    expect(value).toContain('mcp__playwright'); // baseline
    expect(value).toContain('user is already on http://localhost:5173/');
  });

  it('does NOT emit Claude-specific flags', () => {
    const argv = codexAgent.buildArgs({
      agentId: 'codex',
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
    // --append-system-prompt is also unsupported by codex
    expect(argv).not.toContain('--append-system-prompt');
  });
});

// Each test that depends on accumulation (turn count, itemTypeById map,
// sawErrorEvent flag) threads its own state object through parseEvent.
// Tests that don't accumulate omit it (default = {}). This mirrors how
// invokeAgent threads a per-invocation state in production.
describe('codexAgent.parseEvent', () => {
  it('emits session_start on thread.started', () => {
    const events = codexAgent.parseEvent(
      JSON.stringify({ type: 'thread.started', thread_id: '01-99-abc' }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'session_start', sessionId: '01-99-abc' });
  });

  it('emits text on item.completed of type agent_message', () => {
    // The agent_message item arrives complete; no item.started precedes it.
    const events = codexAgent.parseEvent(
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i1', type: 'agent_message', text: 'all done' },
      }),
    );
    expect(events).toEqual([{ kind: 'text', text: 'all done' }]);
  });

  it('emits tool_use on item.started of type mcp_tool_call (and strips mcp__playwright__ prefix)', () => {
    const events = codexAgent.parseEvent(
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'i2',
          type: 'mcp_tool_call',
          name: 'mcp__playwright__browser_click',
          input: { selector: '#go' },
        },
      }),
    );
    expect(events).toEqual([
      { kind: 'tool_use', tool: 'browser_click', input: { selector: '#go' }, costUsdSnapshot: 0, tokensSnapshot: 0 },
    ]);
  });

  it('emits tool_result on item.completed for an mcp_tool_call started earlier', () => {
    const state = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({
      type: 'item.started',
      item: { id: 'i3', type: 'mcp_tool_call', name: 'mcp__playwright__browser_snapshot' },
    }), state);
    const events = codexAgent.parseEvent(JSON.stringify({
      type: 'item.completed',
      item: { id: 'i3' /* type often elided on completion */ },
    }), state);
    expect(events).toEqual([{ kind: 'tool_result', isError: false }]);
  });

  it('marks tool_result.isError when status contains "error"', () => {
    const state = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({
      type: 'item.started',
      item: { id: 'i4', type: 'mcp_tool_call', name: 'mcp__playwright__browser_click' },
    }), state);
    const events = codexAgent.parseEvent(JSON.stringify({
      type: 'item.completed',
      item: { id: 'i4', status: 'error' },
    }), state);
    expect(events).toEqual([{ kind: 'tool_result', isError: true }]);
  });

  it('surfaces command_execution as tool_use shell (even though we discourage it)', () => {
    const events = codexAgent.parseEvent(
      JSON.stringify({
        type: 'item.started',
        item: { id: 'i5', type: 'command_execution', command: 'ls' },
      }),
    );
    expect(events).toEqual([
      { kind: 'tool_use', tool: 'shell', input: { command: 'ls' }, costUsdSnapshot: 0, tokensSnapshot: 0 },
    ]);
  });

  it('accumulates usage and turns on turn.completed', () => {
    const state = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({
      type: 'thread.started',
      thread_id: 't1',
    }), state);
    const t1 = codexAgent.parseEvent(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 1000, output_tokens: 200 },
    }), state);
    expect(t1).toHaveLength(1);
    expect(t1[0].kind).toBe('usage');
    if (t1[0].kind === 'usage') {
      expect(t1[0].turns).toBe(1);
      expect(t1[0].costUsd).toBeGreaterThan(0);
    }

    const t2 = codexAgent.parseEvent(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 500, output_tokens: 100 },
    }), state);
    if (t2[0]?.kind === 'usage') {
      expect(t2[0].turns).toBe(2);
    }
  });

  it('falls back to a raw event when stdout emits a non-JSON line', () => {
    const events = codexAgent.parseEvent('not json here');
    expect(events).toEqual([{ kind: 'raw', line: 'not json here' }]);
  });

  it('returns [] on blank lines', () => {
    expect(codexAgent.parseEvent('')).toEqual([]);
    expect(codexAgent.parseEvent('   ')).toEqual([]);
  });

  it('flags error events and forwards their message text', () => {
    const events = codexAgent.parseEvent(JSON.stringify({
      type: 'turn.error',
      message: 'rate limited',
    }));
    expect(events).toEqual([{ kind: 'text', text: '[codex] rate limited' }]);
  });
});

describe('codexAgent.onStreamEnd', () => {
  it('synthesizes session_end with the last agent_message as summary', () => {
    const state = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({ type: 'thread.started', thread_id: 't' }), state);
    codexAgent.parseEvent(JSON.stringify({
      type: 'item.completed',
      item: { id: 'i1', type: 'agent_message', text: 'wrapped up' },
    }), state);
    codexAgent.parseEvent(JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 10, output_tokens: 5 },
    }), state);

    const end = codexAgent.onStreamEnd!(0, state) as InvokeEvent;
    expect(end.kind).toBe('session_end');
    if (end.kind === 'session_end') {
      expect(end.summary).toBe('wrapped up');
      expect(end.turns).toBe(1);
      expect(end.isError).toBe(false);
      expect(end.costUsd).toBeGreaterThan(0);
    }
  });

  it('flags isError when the child exits non-zero', () => {
    const state = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({ type: 'thread.started', thread_id: 't' }), state);
    const end = codexAgent.onStreamEnd!(1, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('flags isError when an error event was seen mid-stream even on clean exit', () => {
    const state = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({ type: 'thread.started', thread_id: 't' }), state);
    codexAgent.parseEvent(JSON.stringify({ type: 'turn.error', message: 'oops' }), state);
    const end = codexAgent.onStreamEnd!(0, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('two concurrent parser states do not interfere', () => {
    const a = __testing.freshState();
    const b = __testing.freshState();
    codexAgent.parseEvent(JSON.stringify({ type: 'thread.started', thread_id: 'A' }), a);
    codexAgent.parseEvent(JSON.stringify({ type: 'thread.started', thread_id: 'B' }), b);
    codexAgent.parseEvent(JSON.stringify({
      type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 },
    }), a);
    codexAgent.parseEvent(JSON.stringify({
      type: 'turn.completed', usage: { input_tokens: 200, output_tokens: 100 },
    }), b);
    codexAgent.parseEvent(JSON.stringify({
      type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 50 },
    }), a);
    const sa = __testing.getState(a);
    const sb = __testing.getState(b);
    expect(sa.runningTurns).toBe(2);
    expect(sb.runningTurns).toBe(1);
    expect(sa.runningSessionId).toBe('A');
    expect(sb.runningSessionId).toBe('B');
  });
});
