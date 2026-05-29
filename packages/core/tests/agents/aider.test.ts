import { describe, it, expect } from 'vitest';
import { aiderAgent, __testing } from '../../src/agents/aider.js';
import type { InvokeEvent } from '../../src/agents/types.js';

describe('aiderAgent metadata', () => {
  it('declares soft sandbox + plain-text stream + argv protocol', () => {
    expect(aiderAgent.id).toBe('aider');
    expect(aiderAgent.binName).toBe('aider');
    expect(aiderAgent.protocol).toBe('argv');
    expect(aiderAgent.streamFormat).toBe('plain-text');
    expect(aiderAgent.sandboxStrength).toBe('soft');
    expect(aiderAgent.display.label).toBe('Aider');
    // Install hint should point users at pipx (recommended path).
    expect(aiderAgent.display.installHint).toContain('aider-chat');
  });
});

describe('aiderAgent.buildArgs', () => {
  it('uses --message with the HOVER-mode preface prepended to the prompt, plus --yes-always / --no-stream / --no-git / --no-auto-commits', () => {
    const argv = aiderAgent.buildArgs({ agentId: 'aider', prompt: 'do a thing' });
    expect(argv[0]).toBe('--message');
    expect(typeof argv[1]).toBe('string');
    expect(argv[1]).toMatch(/mcp__playwright/);
    expect(argv[1]).toContain('do a thing');
    expect(argv).toContain('--yes-always');
    expect(argv).toContain('--no-stream');
    expect(argv).toContain('--no-git');
    expect(argv).toContain('--no-auto-commits');
  });

  it('forwards model selection with --model', () => {
    const argv = aiderAgent.buildArgs({
      agentId: 'aider',
      prompt: 'p',
      model: 'gpt-5',
    });
    expect(argv).toContain('--model');
    expect(argv).toContain('gpt-5');
  });

  it('folds appendSystemPrompt into the preface prepended to the user prompt', () => {
    const argv = aiderAgent.buildArgs({
      agentId: 'aider',
      prompt: 'the user task',
      appendSystemPrompt: 'user is already on http://localhost:5173/',
    });
    const prompt = argv[1]!;
    expect(prompt).toContain('mcp__playwright');
    expect(prompt).toContain('user is already on http://localhost:5173/');
    expect(prompt).toContain('the user task');
    expect(prompt.indexOf('mcp__playwright')).toBeLessThan(prompt.indexOf('the user task'));
    expect(prompt.indexOf('user is already on')).toBeLessThan(prompt.indexOf('the user task'));
  });

  it('ignores sessionId — aider has no per-session-id resume flag', () => {
    const argv = aiderAgent.buildArgs({
      agentId: 'aider',
      prompt: 'p',
      sessionId: 'whatever-id',
    });
    // No --resume / --continue / --restore-chat-history-with-id flag exists.
    expect(argv).not.toContain('--resume');
    expect(argv).not.toContain('--continue');
    expect(argv).not.toContain('--restore-chat-history');
  });

  it('does NOT emit flags from other agents that aider does not understand', () => {
    const argv = aiderAgent.buildArgs({
      agentId: 'aider',
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
    expect(argv).not.toContain('--output-format');
    expect(argv).not.toContain('--approval-mode');
    expect(argv).not.toContain('--yolo');
    expect(argv).not.toContain('--force');
    expect(argv).not.toContain('-p');
  });
});

describe('aiderAgent.parseEvent', () => {
  it('emits a synthetic session_start on the very first parsed line', () => {
    const state = __testing.freshState();
    const events = aiderAgent.parseEvent('hello there', state);
    expect(events[0]?.kind).toBe('session_start');
    if (events[0]?.kind === 'session_start') {
      // We generate an id locally — it should at least be a non-empty string.
      expect(typeof events[0].sessionId).toBe('string');
      expect(events[0].sessionId.length).toBeGreaterThan(0);
    }
    // Subsequent lines should NOT re-emit session_start.
    const more = aiderAgent.parseEvent('another line', state);
    expect(more.find(e => e.kind === 'session_start')).toBeUndefined();
  });

  it('surfaces plain assistant text as a text event', () => {
    const state = __testing.freshState();
    const events = aiderAgent.parseEvent('The login button was clicked.', state);
    // First event is session_start (synthetic, on first parse).
    const text = events.find(e => e.kind === 'text');
    expect(text).toBeDefined();
    if (text?.kind === 'text') {
      expect(text.text).toBe('The login button was clicked.');
    }
  });

  it('drops empty / whitespace-only lines without emitting text', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('first line', state); // bumps session_start
    const blanks = aiderAgent.parseEvent('   ', state);
    expect(blanks.find(e => e.kind === 'text')).toBeUndefined();
    const empty = aiderAgent.parseEvent('', state);
    expect(empty.find(e => e.kind === 'text')).toBeUndefined();
  });

  it('drops aider boilerplate noise lines (banner, tokens, repo info)', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('first', state); // session_start
    const noisy = [
      'Aider v0.86.2',
      'Main model: gpt-5 with diff edit format',
      'Weak model: gpt-4o',
      'Git repo: .git with 12 files',
      'Repo-map: using 1024 tokens',
      'Tokens: 1.2k sent, 0.3k received',
      '─────────────',
    ];
    for (const line of noisy) {
      const events = aiderAgent.parseEvent(line, state);
      expect(events.find(e => e.kind === 'text')).toBeUndefined();
    }
  });

  it('flags error lines and records them in state', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('first', state);
    const events = aiderAgent.parseEvent('API error: rate limited', state);
    const text = events.find(e => e.kind === 'text');
    expect(text).toBeDefined();
    expect(__testing.getState(state).sawErrorEvent).toBe(true);
  });

  it('accumulates text across multiple lines into collectedText', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('line one', state);
    aiderAgent.parseEvent('line two', state);
    aiderAgent.parseEvent('line three', state);
    const s = __testing.getState(state);
    expect(s.runningLines).toBe(3);
    expect(s.collectedText).toEqual(['line one', 'line two', 'line three']);
  });
});

describe('aiderAgent.onStreamEnd', () => {
  it('synthesizes session_end with the last text line as summary', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('first', state);
    aiderAgent.parseEvent('middle', state);
    aiderAgent.parseEvent('the final answer', state);

    const end = aiderAgent.onStreamEnd!(0, state) as InvokeEvent;
    expect(end.kind).toBe('session_end');
    if (end.kind === 'session_end') {
      expect(end.summary).toBe('the final answer');
      expect(end.turns).toBe(3);
      expect(end.isError).toBe(false);
      // No fabricated cost — aider's Tokens: line isn't a stable API.
      expect(end.costUsd).toBeUndefined();
    }
  });

  it('flags isError when the child exits non-zero even with no error lines', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('some text', state);
    const end = aiderAgent.onStreamEnd!(1, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('flags isError when an error line was parsed even if exit code is 0', () => {
    const state = __testing.freshState();
    aiderAgent.parseEvent('first', state);
    aiderAgent.parseEvent('Error: something exploded', state);
    const end = aiderAgent.onStreamEnd!(0, state) as InvokeEvent;
    if (end.kind === 'session_end') {
      expect(end.isError).toBe(true);
    }
  });

  it('two concurrent parser states do not interfere', () => {
    const a = __testing.freshState();
    const b = __testing.freshState();
    aiderAgent.parseEvent('a1', a);
    aiderAgent.parseEvent('b1', b);
    aiderAgent.parseEvent('a2', a);
    aiderAgent.parseEvent('b2', b);
    aiderAgent.parseEvent('a3', a);
    const sa = __testing.getState(a);
    const sb = __testing.getState(b);
    expect(sa.runningLines).toBe(3);
    expect(sb.runningLines).toBe(2);
    expect(sa.collectedText).toEqual(['a1', 'a2', 'a3']);
    expect(sb.collectedText).toEqual(['b1', 'b2']);
    expect(sa.runningSessionId).not.toBe(sb.runningSessionId);
  });
});
