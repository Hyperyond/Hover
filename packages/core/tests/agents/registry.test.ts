import { describe, it, expect } from 'vitest';
import { AGENTS, getAgent } from '../../src/agents/registry.js';

describe('AGENTS registry', () => {
  it('exposes the claude descriptor', () => {
    expect(AGENTS.claude).toBeDefined();
    expect(AGENTS.claude.id).toBe('claude');
    expect(AGENTS.claude.binName).toBe('claude');
  });

  it('returns the descriptor by id', () => {
    expect(getAgent('claude')?.id).toBe('claude');
  });

  it('returns undefined for unknown ids', () => {
    expect(getAgent('nonexistent-agent')).toBeUndefined();
  });
});
