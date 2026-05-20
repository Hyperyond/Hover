import type { AgentDescriptor } from './types.js';
import { claudeAgent } from './claude.js';

/**
 * Registry of agents Hover can drive. Currently only `claude` is fully wired.
 *
 * To add support for another agent (e.g. codex, cursor-agent, aider, gemini,
 * cline, continue, qwen, kilo), implement its AgentDescriptor in its own
 * file and register it here. The rest of the system — detect, argv, invoke,
 * smoke — works without further changes.
 */
export const AGENTS: Record<string, AgentDescriptor> = {
  [claudeAgent.id]: claudeAgent,
};

export function getAgent(id: string): AgentDescriptor | undefined {
  return AGENTS[id];
}
