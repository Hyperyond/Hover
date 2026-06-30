import { pickPrimaryAgent, type InvokeEvent } from '@hover-dev/core';
import {
  launchDebugChrome,
  buildGroundedMcpConfig,
  runSession,
  CONTROL_MCP_TOOL_PREFIX,
  GROUNDED_ACTUATION_DENY,
  GROUNDED_ACTUATION_DIRECTIVE,
  QA_EXPLORATION_DIRECTIVE,
  QA_INTENSITY,
  qaBudgetDirective,
  type QaIntensity,
  type RunSessionResult,
} from '@hover-dev/core/engine';

/* The real engine wiring: detect the user's agent, launch the debug Chrome,
 * build the GROUNDED MCP config (same as the extension's normal mode, so the
 * selectors the agent actuates with are the ones crystallized — record==replay)
 * and run one agent-driven session, streaming events to `onEvent`. */

export interface DriveOptions {
  /** The instruction for this run (a goal, or an explore directive). */
  goal: string;
  /** Dev-server origin to drive, e.g. `http://localhost:5173`. */
  target: string;
  /** Project root — agent cwd, spec write root, MCP resolution base. */
  devRoot: string;
  agentId?: string;
  model?: string;
  /** CDP port for the debug Chrome (default 9222). */
  cdpPort?: number;
  /** WS port of the control back-channel (record-candidate / ask-user / facts).
   *  Omit for a plain run — actuation still works; the back-channel no-ops. */
  approvalPort?: number;
  /** Hard ceiling on agent turns (~steps). */
  maxTurns?: number;
  /** Extra system-prompt directives appended after the grounded one. */
  extraDirectives?: string[];
  signal?: AbortSignal;
  onEvent: (ev: InvokeEvent) => void;
}

/** The minimal contract the UI depends on — injectable so the hook/tests can
 *  swap in a fake runner without spawning Chrome or an agent. */
export type Runner = (
  goal: string,
  onEvent: (ev: InvokeEvent) => void,
  signal?: AbortSignal,
) => Promise<RunSessionResult>;

export async function driveSession(opts: DriveOptions): Promise<RunSessionResult> {
  const agent = await pickPrimaryAgent(opts.agentId);
  if (!agent) {
    throw new Error('No coding-agent CLI found on PATH. Install `claude` (claude.ai/code) or `codex`.');
  }

  const port = opts.cdpPort ?? 9222;
  const cdpUrl = `http://localhost:${port}`;

  const launch = await launchDebugChrome({ port, url: opts.target });
  if (!launch.ok) throw new Error(`Could not launch debug Chrome: ${launch.reason}`);

  const mcpConfig = buildGroundedMcpConfig({
    cdpUrl,
    port,
    devRoot: opts.devRoot,
    devUrl: opts.target,
    approvalPort: opts.approvalPort,
  });

  const appendSystemPrompt = [GROUNDED_ACTUATION_DIRECTIVE, ...(opts.extraDirectives ?? [])].join('\n\n');

  return runSession(
    {
      prompt: opts.goal,
      agentId: agent.descriptor.id,
      model: opts.model,
      cdpUrl,
      cwd: opts.devRoot,
      mcpConfig,
      maxTurns: opts.maxTurns,
      // Grounded actuation: allow the control server, deny Playwright's loose
      // interaction tools, and tell the agent to use the grounded ones.
      allowedToolsExtra: [CONTROL_MCP_TOOL_PREFIX],
      disallowedToolsExtra: GROUNDED_ACTUATION_DENY,
      appendSystemPrompt,
      signal: opts.signal,
    },
    opts.onEvent,
  );
}

/** A default explore goal when the user gives none — QA_EXPLORATION_DIRECTIVE
 *  reads a bare "test this" as "explore the whole app". */
export const DEFAULT_EXPLORE_GOAL = 'Explore this app and test its main flows.';

export interface ExploreOptions extends Omit<DriveOptions, 'goal' | 'extraDirectives' | 'maxTurns'> {
  /** The user's goal, or empty to explore the whole app. */
  goal?: string;
  intensity: QaIntensity;
}

/**
 * Autonomous exploration: drive the app to discover its business flows. The
 * agent exercises controls, `record_candidate`s each clean end-to-end flow (the
 * back-channel collects them), `record_fact`s rules, and `ask_user`s when
 * blocked. Reuses QA mode's directives + step budget verbatim.
 */
export function driveExplore(opts: ExploreOptions): Promise<RunSessionResult> {
  return driveSession({
    ...opts,
    goal: opts.goal?.trim() || DEFAULT_EXPLORE_GOAL,
    maxTurns: QA_INTENSITY[opts.intensity].maxSteps,
    extraDirectives: [QA_EXPLORATION_DIRECTIVE, qaBudgetDirective(opts.intensity)],
  });
}

/** Bind a {@link DriveOptions} context into a {@link Runner} for the UI hook. */
export function makeRunner(ctx: Omit<DriveOptions, 'goal' | 'onEvent' | 'signal'>): Runner {
  return (goal, onEvent, signal) => driveSession({ ...ctx, goal, onEvent, signal });
}
