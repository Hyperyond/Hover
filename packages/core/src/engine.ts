/**
 * In-process engine surface for non-service consumers — the `hover` CLI and the
 * `@hover-dev/mcp` server. The VS Code extension drives core through the WS
 * service (`./service`); a standalone process instead calls `runSession`
 * directly. This barrel exposes the same building blocks the service composes —
 * the session run, the GROUNDED MCP config (so a CLI-authored spec gets the
 * record==replay fidelity the extension does), and spec crystallization —
 * without the WebSocket layer.
 *
 * Keep this a thin re-export + the one `buildGroundedMcpConfig` helper. The
 * grounded path here MUST stay in lock-step with `service.ts`'s normal-mode
 * assembly (the control-actuation server + `GROUNDED_ACTUATION_DENY` /
 * `GROUNDED_ACTUATION_DIRECTIVE`), or CLI specs would drift from extension specs.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMcpConfig, mcpToolPrefix } from './playwright/resolveMcpConfig.js';

// ── in-process session + crystallization ─────────────────────────────────────
export { runSession } from './runSession.js';
export type { RunSessionOptions, RunSessionResult } from './runSession.js';
export { writeSpec } from './specs/writeSpec.js';
export type { WriteSpecOptions, WriteSpecResult, Redaction } from './specs/writeSpec.js';
export type { SkillStep } from './specs/specStep.js';
// Creation-verification: replay a flow's grounded steps over CDP (no playwright test).
export { replayGroundedSteps, replayOnPage, applyGroundedStep, groundedLocate } from './specs/replayGrounded.js';
export type { ReplayResult, ReplayFailure, ReplayStep, GroundedTarget } from './specs/replayGrounded.js';

// ── browser / MCP plumbing ───────────────────────────────────────────────────
export { resolveMcpConfig, mcpToolPrefix } from './playwright/resolveMcpConfig.js';
export { launchDebugChrome, closeDebugChrome, findChromeBinary } from './playwright/launchChrome.js';
export type { LaunchOptions, LaunchResult } from './playwright/launchChrome.js';

// ── grounded-actuation knobs (must match service.ts) ─────────────────────────
export { GROUNDED_ACTUATION_DENY, GROUNDED_ACTUATION_DIRECTIVE } from './agentDirectives.js';

// ── business memory (ask → remember loop; shared with the extension's QA mode) ─
export { loadMemory, formatMemoryForPrompt, writeFact, memoryDir } from './memory/businessMemory.js';
export type { BusinessFact } from './memory/businessMemory.js';

// ── autonomous-exploration directives (QA mode reuse) ────────────────────────
// The CLI's "explore → discover business flows → record_candidate" loop is the
// same mechanism QA mode drives the agent with; reuse the directives verbatim
// so behaviour stays in lock-step.
export { RECON_DIRECTIVE, QA_EXPLORATION_DIRECTIVE } from './agentDirectives.js';
export { QA_INTENSITY, DEFAULT_QA_INTENSITY, asQaIntensity, qaBudgetDirective } from './qa/intensity.js';
export type { QaIntensity, QaIntensitySpec } from './qa/intensity.js';

/**
 * The always-on control-actuation MCP server id. Alphanumeric on purpose — a
 * hyphen would make the hard-sandbox allow prefix (`mcp__hovercontrol`) fail to
 * match the tool names (`mcp__hovercontrol__click_control`), so every grounded
 * actuation would be denied. (Same constant + reasoning as service.ts.)
 */
export const CONTROL_MCP_ID = 'hovercontrol';

/** The hard-sandbox allow prefix for the control server — pass in
 *  `runSession({ allowedToolsExtra: [CONTROL_MCP_TOOL_PREFIX] })`. */
export const CONTROL_MCP_TOOL_PREFIX = mcpToolPrefix(CONTROL_MCP_ID);

// dist/engine.js sits beside dist/service.js, so mcp/actuateServer.js resolves
// the same way it does from service.ts.
const CONTROL_MCP_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'mcp', 'actuateServer.js');

export interface GroundedMcpOptions {
  /** CDP endpoint of the debug Chrome the agent drives. */
  cdpUrl: string;
  /** Port used only to namespace the generated config filename. */
  port: number;
  /** Project root — where the control server resolves relative paths / writes
   *  its placeholder upload fixture, and where `@playwright/mcp` resolves from. */
  devRoot: string;
  /** The dev-server origin the run targets (defaults to `cdpUrl`). */
  devUrl?: string;
  /** WS port the control server's back-channel (`ask_user` / `record_*`)
   *  connects to. Omit when there's no listener — actuation still works; the
   *  back-channel features silently no-op (actuateServer fails soft). */
  approvalPort?: number;
  /** Directory the Playwright MCP + control screenshots write into. */
  outputDir?: string;
}

/**
 * Build an MCP config mirroring the service's grounded/normal mode: the
 * Playwright MCP over CDP PLUS the hover-control actuation server. Pair it in
 * `runSession` with `allowedToolsExtra: [CONTROL_MCP_TOOL_PREFIX]`,
 * `disallowedToolsExtra: GROUNDED_ACTUATION_DENY`, and append
 * `GROUNDED_ACTUATION_DIRECTIVE` to the system prompt — then the selectors the
 * agent actuates with are the ones crystallized (record==replay).
 */
export function buildGroundedMcpConfig(opts: GroundedMcpOptions): string {
  return resolveMcpConfig({
    cdpUrl: opts.cdpUrl,
    port: opts.port,
    cwd: opts.devRoot,
    outputDir: opts.outputDir,
    extra: [
      {
        id: CONTROL_MCP_ID,
        command: process.execPath,
        args: [CONTROL_MCP_SCRIPT],
        env: {
          HOVER_CDP_URL: opts.cdpUrl,
          HOVER_DEV_URL: opts.devUrl ?? opts.cdpUrl,
          HOVER_PROJECT_ROOT: opts.devRoot,
          ...(opts.approvalPort ? { HOVER_APPROVAL_PORT: String(opts.approvalPort) } : {}),
          ...(opts.outputDir ? { HOVER_SHOT_DIR: opts.outputDir } : {}),
        },
      },
    ],
  });
}
