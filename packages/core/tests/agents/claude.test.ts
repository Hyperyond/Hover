import { describe, it, expect } from 'vitest';
import { claudeAgent } from '../../src/agents/claude.js';

describe('claudeAgent.buildArgs', () => {
  it('builds the minimum argv with prompt + stream-json + dontAsk permission', () => {
    const argv = claudeAgent.buildArgs({ agentId: 'claude', prompt: 'hello' });
    expect(argv.slice(0, 2)).toEqual(['-p', 'hello']);
    expect(argv).toContain('--output-format');
    expect(argv).toContain('stream-json');
    expect(argv).toContain('--verbose');
    expect(argv).toContain('--permission-mode');
    expect(argv).toContain('dontAsk');
  });

  it('emits --strict-mcp-config when mcpConfig is provided', () => {
    const argv = claudeAgent.buildArgs({
      agentId: 'claude',
      prompt: 'p',
      mcpConfig: '/tmp/mcp.json',
    });
    expect(argv).toContain('--mcp-config');
    expect(argv).toContain('/tmp/mcp.json');
    expect(argv).toContain('--strict-mcp-config');
  });

  it('joins allowed/disallowed tool lists', () => {
    const argv = claudeAgent.buildArgs({
      agentId: 'claude',
      prompt: 'p',
      allowedTools: ['mcp__playwright'],
      disallowedTools: ['Bash', 'Edit'],
    });
    expect(argv).toContain('--allowedTools');
    expect(argv).toContain('mcp__playwright');
    expect(argv).toContain('--disallowedTools');
    expect(argv).toContain('Bash');
    expect(argv).toContain('Edit');
  });

  it('disables the arbitrary-JS Playwright tools (run_code / evaluate) by default', () => {
    expect(claudeAgent.defaultDisallowedTools).toContain('mcp__playwright__browser_run_code_unsafe');
    expect(claudeAgent.defaultDisallowedTools).toContain('mcp__playwright__browser_evaluate');
    // the existing built-in denials still hold
    expect(claudeAgent.defaultDisallowedTools).toContain('Bash');
  });

  it('passes through the budget ceiling', () => {
    const argv = claudeAgent.buildArgs({ agentId: 'claude', prompt: 'p', maxBudgetUsd: 0.5 });
    expect(argv).toContain('--max-budget-usd');
    expect(argv).toContain('0.5');
  });

  it('appends --resume only when a session id is provided', () => {
    const noResume = claudeAgent.buildArgs({ agentId: 'claude', prompt: 'p' });
    expect(noResume).not.toContain('--resume');

    const withResume = claudeAgent.buildArgs({ agentId: 'claude', prompt: 'p', sessionId: 'abc' });
    expect(withResume).toContain('--resume');
    expect(withResume).toContain('abc');
  });
});

describe('claudeAgent.parseEvent', () => {
  it('returns [] for blank lines', () => {
    expect(claudeAgent.parseEvent('')).toEqual([]);
    expect(claudeAgent.parseEvent('   ')).toEqual([]);
  });

  it('wraps non-JSON lines as raw events', () => {
    const events = claudeAgent.parseEvent('this is not json');
    expect(events).toEqual([{ kind: 'raw', line: 'this is not json' }]);
  });

  it('parses system/init into session_start and mcp_status events', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      model: 'sonnet',
      mcp_servers: [{ name: 'playwright', status: 'connected' }],
    });
    expect(claudeAgent.parseEvent(line)).toEqual([
      { kind: 'session_start', sessionId: 'sess-1', model: 'sonnet' },
      { kind: 'mcp_status', server: 'playwright', status: 'connected' },
    ]);
  });

  it('parses assistant tool_use blocks and strips the mcp__playwright__ prefix', () => {
    // Reset the running-cost accumulator by feeding a fresh system/init.
    claudeAgent.parseEvent(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'sonnet' }));
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: { url: '/' } },
        ],
      },
    });
    // Every assistant event now prepends a usage event with the running cost
    // and turn count, so the widget can show a live $ counter mid-stream.
    expect(claudeAgent.parseEvent(line)).toEqual([
      { kind: 'usage', costUsd: 0, turns: 1 },
      { kind: 'tool_use', tool: 'browser_navigate', input: { url: '/' }, costUsdSnapshot: 0 },
    ]);
  });

  it('parses assistant text blocks but drops empty whitespace', () => {
    claudeAgent.parseEvent(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'sonnet' }));
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '   ' }, { type: 'text', text: 'ok' }] },
    });
    expect(claudeAgent.parseEvent(line)).toEqual([
      { kind: 'usage', costUsd: 0, turns: 1 },
      { kind: 'text', text: 'ok' },
    ]);
  });

  it('emits a running cost from intermediate total_cost_usd when present', () => {
    claudeAgent.parseEvent(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'sonnet' }));
    const line = JSON.stringify({
      type: 'assistant',
      total_cost_usd: 0.0123,
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
    expect(claudeAgent.parseEvent(line)).toEqual([
      { kind: 'usage', costUsd: 0.0123, turns: 1 },
      { kind: 'text', text: 'hi' },
    ]);
  });

  it('estimates running cost from message.usage tokens when total_cost_usd is absent', () => {
    claudeAgent.parseEvent(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'sonnet' }));
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [{ type: 'text', text: 'hi' }],
      },
    });
    const events = claudeAgent.parseEvent(line);
    // sonnet pricing: 1000 input @ $3/M + 500 output @ $15/M = $0.003 + $0.0075 = $0.0105
    expect(events[0]).toEqual({ kind: 'usage', costUsd: 0.0105, turns: 1 });
  });

  it('parses result events into session_end', () => {
    const line = JSON.stringify({
      type: 'result',
      num_turns: 3,
      total_cost_usd: 0.012,
      is_error: false,
      result: 'done',
    });
    expect(claudeAgent.parseEvent(line)).toEqual([
      { kind: 'session_end', turns: 3, costUsd: 0.012, isError: false, summary: 'done' },
    ]);
  });
});
