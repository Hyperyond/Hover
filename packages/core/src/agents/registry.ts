import type { AgentDescriptor } from './types.js';
import { claudeAgent } from './claude.js';
import { codexAgent } from './codex.js';
import { geminiAgent } from './gemini.js';
import { qwenAgent } from './qwen.js';

/**
 * Registry of agents Hover can drive.
 *
 * To add support for another agent (e.g. cline, continue, kilo), implement
 * its AgentDescriptor in its own file and register it here. The rest of the
 * system — detect, argv, invoke, service, widget — works without further
 * changes.
 *
 * Insertion order is the order shown in the widget's agent dropdown, so put
 * the recommended primary first. The two hard-sandbox / first-party agents
 * (claude, codex) lead; the soft-sandbox third-party agents follow in the
 * order they were added.
 */
export const AGENTS: Record<string, AgentDescriptor> = {
  [claudeAgent.id]: claudeAgent,
  [codexAgent.id]: codexAgent,
  [geminiAgent.id]: geminiAgent,
  [qwenAgent.id]: qwenAgent,
};

export function getAgent(id: string): AgentDescriptor | undefined {
  return AGENTS[id];
}

/** Stable, insertion-ordered list of all registered agents. */
export function listAgents(): AgentDescriptor[] {
  return Object.values(AGENTS);
}
