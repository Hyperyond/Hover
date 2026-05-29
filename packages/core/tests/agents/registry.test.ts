import { describe, it, expect } from 'vitest';
import { AGENTS, getAgent, listAgents } from '../../src/agents/registry.js';

describe('AGENTS registry', () => {
  it('exposes the claude descriptor', () => {
    expect(AGENTS.claude).toBeDefined();
    expect(AGENTS.claude.id).toBe('claude');
    expect(AGENTS.claude.binName).toBe('claude');
  });

  it('exposes the cursor descriptor', () => {
    expect(AGENTS.cursor).toBeDefined();
    expect(AGENTS.cursor.id).toBe('cursor');
    // The installer creates symlinks for both `agent` and `cursor-agent`;
    // we probe the disambiguated one to avoid name collisions on PATH.
    expect(AGENTS.cursor.binName).toBe('cursor-agent');
    expect(AGENTS.cursor.sandboxStrength).toBe('soft');
  });

  it('exposes the aider descriptor', () => {
    expect(AGENTS.aider).toBeDefined();
    expect(AGENTS.aider.id).toBe('aider');
    expect(AGENTS.aider.binName).toBe('aider');
    // aider only ships plain-text output — no JSON parser is possible.
    expect(AGENTS.aider.streamFormat).toBe('plain-text');
    expect(AGENTS.aider.sandboxStrength).toBe('soft');
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
    expect(getAgent('cursor')?.id).toBe('cursor');
    expect(getAgent('aider')?.id).toBe('aider');
    expect(getAgent('gemini')?.id).toBe('gemini');
    expect(getAgent('qwen')?.id).toBe('qwen');
  });

  it('returns undefined for unknown ids', () => {
    expect(getAgent('nonexistent-agent')).toBeUndefined();
  });

  it('lists exactly six agents in insertion order: claude, codex, cursor, aider, gemini, qwen', () => {
    const ids = listAgents().map(a => a.id);
    expect(ids).toHaveLength(6);
    expect(ids).toEqual(['claude', 'codex', 'cursor', 'aider', 'gemini', 'qwen']);
  });

  it('preserves insertion order: hard-sandbox primaries first, soft-sandbox follow', () => {
    const ids = listAgents().map(a => a.id);
    // Claude / codex are the two first-party (claude=hard, codex=soft but
    // wired since v0.3) agents — they lead.
    expect(ids.indexOf('claude')).toBeLessThan(ids.indexOf('codex'));
    expect(ids.indexOf('codex')).toBeLessThan(ids.indexOf('cursor'));
    // The three v0.10+ additions follow.
    expect(ids.indexOf('cursor')).toBeLessThan(ids.indexOf('aider'));
    expect(ids.indexOf('aider')).toBeLessThan(ids.indexOf('gemini'));
    expect(ids.indexOf('gemini')).toBeLessThan(ids.indexOf('qwen'));
  });
});
