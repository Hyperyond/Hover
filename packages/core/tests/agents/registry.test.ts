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

  it('returns the descriptor by id', () => {
    expect(getAgent('claude')?.id).toBe('claude');
    expect(getAgent('cursor')?.id).toBe('cursor');
  });

  it('returns undefined for unknown ids', () => {
    expect(getAgent('nonexistent-agent')).toBeUndefined();
  });

  it('lists cursor alongside claude and codex in insertion order', () => {
    const ids = listAgents().map(a => a.id);
    expect(ids).toContain('cursor');
    // Claude stays primary; cursor is registered after codex.
    expect(ids.indexOf('claude')).toBeLessThan(ids.indexOf('codex'));
    expect(ids.indexOf('codex')).toBeLessThan(ids.indexOf('cursor'));
  });
});
