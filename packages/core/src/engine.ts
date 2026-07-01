/**
 * In-process engine surface for the `@hover-dev/mcp` server (and any other
 * standalone consumer). The MCP server drives the debug Chrome directly via
 * `playwright-core` and buffers grounded steps, then crystallizes them with
 * `writeSpec` — no WebSocket service, no agent spawning. This barrel re-exports
 * exactly those building blocks.
 *
 * (The old staged-engine surface — `runSession`, the WS `service`, the
 * Playwright-MCP config in `resolveMcpConfig` / `buildGroundedMcpConfig`, and
 * the `mcp/actuateServer` + `mcp/sourceServer` relays — has been removed. The
 * MCP-first path doesn't spawn Playwright's MCP; it actuates through
 * `playwright-core` and `groundedLocate` below, which is what keeps
 * record == replay.)
 */

// ── crystallization + grounded replay ────────────────────────────────────────
export { writeSpec } from './specs/writeSpec.js';
export type { WriteSpecOptions, WriteSpecResult, Redaction } from './specs/writeSpec.js';
export type { SkillStep } from './specs/specStep.js';
export { reRenderSpec } from './specs/writeSpec.js';
// API-layer crystallizer — observed/replayed requests → *.api-test.spec.ts.
export { writeApiSpec } from './specs/writeApiSpec.js';
export type { ApiCheck, WriteApiSpecOptions, WriteApiSpecResult } from './specs/writeApiSpec.js';
// Page-Object extraction — lift NON-login shared flows into pages/ + fixtures.
export { extractPageObjects, detectExtractableFlows } from './specs/extractPageObjects.js';
export type { ExtractResult, ExtractedPage } from './specs/extractPageObjects.js';
export type { SharedFlow } from './specs/detectSharedFlows.js';
// Creation-verification + self-heal: replay a flow's grounded steps over CDP (no playwright test).
export { replayGroundedSteps, replayOnPage, applyGroundedStep, groundedLocate } from './specs/replayGrounded.js';
export type { ReplayResult, ReplayFailure, ReplayStep, GroundedTarget } from './specs/replayGrounded.js';
// Spec sidecar (recorded grounded steps) — read by self-heal to replay a saved spec.
export { readSidecar } from './specs/sidecar.js';
export type { SpecSidecar } from './specs/sidecar.js';

// ── debug-Chrome lifecycle ───────────────────────────────────────────────────
export { launchDebugChrome, closeDebugChrome, findChromeBinary } from './playwright/launchChrome.js';
export type { LaunchOptions, LaunchResult } from './playwright/launchChrome.js';

// ── business memory (ask → remember loop) ────────────────────────────────────
export { loadMemory, formatMemoryForPrompt, writeFact, memoryDir } from './memory/businessMemory.js';
export type { BusinessFact } from './memory/businessMemory.js';

// ── QA intensity (step budget; parked until wired into the workflow) ──────────
export { QA_INTENSITY, DEFAULT_QA_INTENSITY, asQaIntensity, qaBudgetDirective } from './qa/intensity.js';
export type { QaIntensity, QaIntensitySpec } from './qa/intensity.js';
