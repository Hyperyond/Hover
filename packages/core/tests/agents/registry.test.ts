import { describe, it, expect } from 'vitest';
import { AGENTS, getAgent, listAgents } from '../../src/agents/registry.js';

describe('AGENTS registry', () => {
  it('exposes the claude descriptor', () => {
    expect(AGENTS.claude).toBeDefined();
    expect(AGENTS.claude.id).toBe('claude');
    expect(AGENTS.claude.binName).toBe('claude');
  });

  it('exposes the gemini descriptor', () => {
    expect(AGENTS.gemini).toBeDefined();
    expect(AGENTS.gemini.id).toBe('gemini');
    expect(AGENTS.gemini.binName).toBe('gemini');
    expect(AGENTS.gemini.streamFormat).toBe('json-lines');
    expect(AGENTS.gemini.sandboxStrength).toBe('soft');
  });

  it('exposes the qwen descriptor', () => {
    expect(AGENTS.qwen).toBeDefined();
    expect(AGENTS.qwen.id).toBe('qwen');
    expect(AGENTS.qwen.binName).toBe('qwen');
    expect(AGENTS.qwen.streamFormat).toBe('json-lines');
    expect(AGENTS.qwen.sandboxStrength).toBe('soft');
  });

  it('returns the descriptor by id', () => {
    expect(getAgent('claude')?.id).toBe('claude');
    expect(getAgent('gemini')?.id).toBe('gemini');
    expect(getAgent('qwen')?.id).toBe('qwen');
  });

  it('returns undefined for unknown ids', () => {
    expect(getAgent('nonexistent-agent')).toBeUndefined();
  });

  it('lists exactly four agents in insertion order: claude, codex, gemini, qwen', () => {
    const ids = listAgents().map(a => a.id);
    expect(ids).toHaveLength(4);
    expect(ids).toEqual(['claude', 'codex', 'gemini', 'qwen']);
  });

  it('preserves insertion order: hard-sandbox primaries first, soft-sandbox follow', () => {
    const ids = listAgents().map(a => a.id);
    // Claude / codex are the two first-party (claude=hard, codex=soft but
    // wired since v0.3) agents — they lead.
    expect(ids.indexOf('claude')).toBeLessThan(ids.indexOf('codex'));
    expect(ids.indexOf('codex')).toBeLessThan(ids.indexOf('gemini'));
    expect(ids.indexOf('gemini')).toBeLessThan(ids.indexOf('qwen'));
  });
});
