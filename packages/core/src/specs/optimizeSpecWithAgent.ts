/**
 * Wires optimizeSpec's injected codegen call to a real agent via invokeAgent,
 * in "codegen mode": no MCP, no browser tools, the agent's own built-in tools
 * disallowed — it just reads the prompt and emits the improved spec as text.
 *
 * Kept separate from optimizeSpec.ts so the core (prompt / extract / validate /
 * write) stays a pure, spawn-free module that tests import directly.
 */
import { invokeAgent } from '../agents/invoke.js';
import { getAgent } from '../agents/registry.js';
import { optimizeSpec, type OptimizeResult, type RunCodegen } from './optimizeSpec.js';

export interface OptimizeAgentOptions {
  agentId: string;
  model?: string;
  maxBudgetUsd?: number;
  /** Optional model API key, injected into the spawned CLI's env. */
  apiKey?: string;
  signal?: AbortSignal;
}

export async function optimizeSpecWithAgent(
  devRoot: string,
  slug: string,
  opts: OptimizeAgentOptions,
): Promise<OptimizeResult> {
  const descriptor = getAgent(opts.agentId);
  // Codegen mode: deny the agent's built-in tools so it answers with text only;
  // pass no mcpConfig / allowedTools so it never reaches a browser.
  const disallowedTools = descriptor?.defaultDisallowedTools
    ? [...descriptor.defaultDisallowedTools]
    : undefined;

  const runCodegen: RunCodegen = async (prompt) => {
    let streamed = '';
    let summary = '';
    for await (const ev of invokeAgent({
      agentId: opts.agentId,
      prompt,
      model: opts.model,
      maxBudgetUsd: opts.maxBudgetUsd,
      apiKey: opts.apiKey,
      signal: opts.signal,
      disallowedTools,
    })) {
      if (ev.kind === 'text' && ev.text) streamed += `${ev.text}\n`;
      else if (ev.kind === 'session_end' && ev.summary) summary = ev.summary;
    }
    // Prefer the final result summary; fall back to streamed text blocks.
    return summary || streamed;
  };

  return optimizeSpec(devRoot, slug, runCodegen);
}
