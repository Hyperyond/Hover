/**
 * Headless session runner — the invoke + crystallize engine shared by every
 * frontend. The widget reaches it through the WebSocket service; `smoke.ts`
 * and (future) `hover run` call it in-process, no WS server. It spawns the
 * agent against the user's debug Chrome over CDP, streams normalized events to
 * `onEvent`, and accumulates the captured tool calls into a `SpecStep[]` the
 * caller can hand to `writeSpec` — the same shape the service's re-record path
 * builds (`user` seed → `step` per tool_use → `done` with the final summary).
 *
 * No WebSocket, no DOM. It drives an *already-running* debug Chrome over CDP;
 * launching Chrome / CDP preflight is the caller's call (the service does it
 * with autoLaunch; the CLI will too). The sandbox (allow/deny tools) mirrors
 * the service exactly, gated on the agent's `sandboxStrength`.
 */
import { invokeAgent } from './agents/invoke.js';
import { getAgent } from './agents/registry.js';
import type { InvokeEvent } from './agents/types.js';
import type { SkillStep } from './skills/writeSkill.js';
import { resolveMcpConfig } from './playwright/resolveMcpConfig.js';

export interface RunSessionOptions {
  prompt: string;
  agentId: string;
  /** CDP URL of the debug Chrome the agent drives (e.g. http://localhost:9222). */
  cdpUrl: string;
  model?: string;
  maxBudgetUsd?: number;
  /** Optional model API key, injected into the spawned CLI's env. */
  apiKey?: string;
  /** Agent cwd (project root) — where Claude Code reads CLAUDE.md and where a
   *  later `--save` writes the spec / `.hover` artifacts. Defaults to cwd. */
  cwd?: string;
  /** Namespaces the temp MCP config filename. Defaults to 51789. */
  port?: number;
  signal?: AbortSignal;
}

export interface RunSessionResult {
  /** Captured session as SpecStep[] (`user` → `step`* → `done`), ready to hand
   *  straight to `writeSpec`. */
  steps: SkillStep[];
  /** The agent's final summary, if any. */
  summary: string;
  /** True if the run ended in error or was aborted. */
  isError: boolean;
}

export async function runSession(
  opts: RunSessionOptions,
  onEvent: (ev: InvokeEvent) => void,
): Promise<RunSessionResult> {
  const descriptor = getAgent(opts.agentId);
  const isHardSandbox = descriptor?.sandboxStrength === 'hard';

  // Seed with a synthetic `user` step so writeSpec's JSDoc `Original prompt:`
  // line carries the prompt the agent was given (mirrors the service path).
  const steps: SkillStep[] = [{ kind: 'user', text: opts.prompt }];
  let summary = '';
  let isError = false;

  const mcpConfig = resolveMcpConfig({ cdpUrl: opts.cdpUrl, port: opts.port ?? 51789 });

  for await (const ev of invokeAgent({
    agentId: opts.agentId,
    prompt: opts.prompt,
    mcpConfig,
    // Hard sandbox: only Playwright MCP is callable, every built-in tool
    // denied — a hijacked prompt can't reach the shell or filesystem. Soft
    // agents (codex, …) enforce their own sandbox via buildArgs, so we leave
    // the lists undefined for them — exactly what the service does.
    allowedTools: isHardSandbox ? ['mcp__playwright'] : undefined,
    disallowedTools: isHardSandbox
      ? (descriptor?.defaultDisallowedTools ? [...descriptor.defaultDisallowedTools] : undefined)
      : undefined,
    maxBudgetUsd: opts.maxBudgetUsd,
    model: opts.model,
    apiKey: opts.apiKey,
    cwd: opts.cwd,
    signal: opts.signal,
  })) {
    onEvent(ev);
    if (ev.kind === 'tool_use') {
      steps.push({ kind: 'step', tool: ev.tool, input: ev.input });
    } else if (ev.kind === 'session_end') {
      if (ev.summary) summary = ev.summary;
      if (ev.isError) isError = true;
    }
  }

  if (summary) steps.push({ kind: 'done', summary });
  return { steps, summary, isError };
}
