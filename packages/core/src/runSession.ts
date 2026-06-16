/**
 * Headless session runner — the invoke + crystallize engine shared by every
 * frontend. The widget reaches it through the WebSocket service; `smoke.ts`
 * and (future) `hover run` call it in-process, no WS server. It spawns the
 * agent against the user's debug Chrome over CDP, streams normalized events to
 * `onEvent`, and accumulates the captured tool calls into a `SpecStep[]` the
 * caller can hand to `writeSpec` — `user` seed → `step` per tool_use → `done`
 * with the final summary (the exact shape the spec pipeline consumes).
 *
 * No WebSocket, no DOM. It drives an *already-running* debug Chrome over CDP;
 * launching Chrome / CDP preflight is the caller's call (the service does it
 * with autoLaunch; the CLI will too). The sandbox (allow/deny tools) mirrors
 * the service exactly, gated on the agent's `sandboxStrength`.
 *
 * The full surface (mcpConfig override, allowedToolsExtra, appendSystemPrompt,
 * sessionId) lets the service delegate to this instead of duplicating the
 * invoke loop; the CLI uses only the small subset (prompt + cdpUrl + model).
 */
import { invokeAgent } from './agents/invoke.js';
import { getAgent } from './agents/registry.js';
import type { InvokeEvent } from './agents/types.js';
import type { SkillStep } from './skills/writeSkill.js';
import { resolveMcpConfig } from './playwright/resolveMcpConfig.js';

export interface RunSessionOptions {
  prompt: string;
  agentId: string;
  /** CDP URL of the debug Chrome the agent drives. Required unless `mcpConfig`
   *  is supplied (the service passes a pre-built config; the CLI passes this). */
  cdpUrl?: string;
  model?: string;
  /** Reasoning-effort level forwarded to the agent (claude --effort / codex
   *  -c model_reasoning_effort). Undefined = agent/model default. */
  effort?: string;
  maxBudgetUsd?: number;
  /** Optional model API key, injected into the spawned CLI's env. */
  apiKey?: string;
  /** Agent cwd (project root) — where Claude Code reads CLAUDE.md and where a
   *  `--save` / re-record writes the spec. Defaults to the process cwd. */
  cwd?: string;
  /** Namespaces the temp MCP config filename. Defaults to 51789. */
  port?: number;
  signal?: AbortSignal;
  /** Pre-built MCP config path. The service supplies one (with plugin servers);
   *  when omitted, runSession builds a plugin-free Playwright config from
   *  `cdpUrl` via resolveMcpConfig. */
  mcpConfig?: string;
  /** Extra hard-sandbox allow-list prefixes — e.g. active-mode plugin MCP
   *  server ids the service contributes. Appended to ['mcp__playwright']. */
  allowedToolsExtra?: string[];
  /** Extra hard-sandbox deny entries — specific tools to forbid even though
   *  their server is allowed. Normal mode passes the Playwright interaction
   *  tools (browser_click / _type / _fill_form / _select_option) here so the
   *  agent must use the grounded mcp__hover-control__* actuation tools, whose
   *  role+name selectors crystallize 1:1 instead of confabulating getByText. */
  disallowedToolsExtra?: string[];
  /** Appended to the agent's system prompt (the service folds in cdpHint +
   *  conventions + plugin additions + a language directive; the CLI omits it). */
  appendSystemPrompt?: string;
  /** Resume an existing agent session (a follow-up turn). */
  sessionId?: string;
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
  // Index of the most recently captured tool step, so the tool_result that
  // follows can mark whether that action errored. Without this, every captured
  // step looks successful and the agent's failed exploration attempts get
  // crystallized into the spec as if they were real flow.
  let lastStepIdx = -1;

  const mcpConfig =
    opts.mcpConfig ??
    resolveMcpConfig({
      cdpUrl: opts.cdpUrl ?? 'http://localhost:9222',
      port: opts.port ?? 51789,
      // Resolve @playwright/mcp from the run's cwd, not the dir the CLI was
      // invoked from — `hover run --cwd apps/web` must find the MCP package
      // under the target workspace in a monorepo.
      cwd: opts.cwd,
    });

  for await (const ev of invokeAgent({
    agentId: opts.agentId,
    prompt: opts.prompt,
    sessionId: opts.sessionId,
    mcpConfig,
    cwd: opts.cwd,
    appendSystemPrompt: opts.appendSystemPrompt,
    // Hard sandbox: only Playwright MCP (+ any active-mode plugin servers) is
    // callable, every built-in tool denied — a hijacked prompt can't reach the
    // shell or filesystem. Soft agents (codex, …) enforce their own sandbox via
    // buildArgs, so the lists stay undefined for them — exactly what the
    // service does.
    allowedTools: isHardSandbox
      ? ['mcp__playwright', ...(opts.allowedToolsExtra ?? [])]
      : undefined,
    disallowedTools: isHardSandbox
      ? [...(descriptor?.defaultDisallowedTools ?? []), ...(opts.disallowedToolsExtra ?? [])]
      : undefined,
    maxBudgetUsd: opts.maxBudgetUsd,
    model: opts.model,
    effort: opts.effort,
    apiKey: opts.apiKey,
    signal: opts.signal,
  })) {
    onEvent(ev);
    if (ev.kind === 'tool_use') {
      lastStepIdx = steps.push({ kind: 'step', tool: ev.tool, input: ev.input }) - 1;
    } else if (ev.kind === 'tool_result') {
      // Mark the step this result belongs to (the normalized stream emits
      // tool_result right after its tool_use). A failed action stays in the
      // sidecar as part of the full-fidelity record, but writeSpec drops it from
      // the runnable spec so the artifact reflects the working flow, not the agent's
      // trial-and-error.
      if (lastStepIdx >= 0 && ev.isError) steps[lastStepIdx].isError = true;
    } else if (ev.kind === 'session_end') {
      if (ev.summary) summary = ev.summary;
      if (ev.isError) isError = true;
    }
  }

  // On abort (opts.signal), invokeAgent SIGTERMs the child and no session_end
  // arrives, so the error flag above never gets set. Honour the doc contract
  // ("True if the run ended in error or was aborted") by flipping it here.
  if (opts.signal?.aborted) isError = true;

  if (summary) steps.push({ kind: 'done', summary });
  return { steps, summary, isError };
}
