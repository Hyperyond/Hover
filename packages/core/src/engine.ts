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
// Optimize (F7) — build the improvement brief for the user's own agent, then
// file its result as a reviewed candidate. No Hover-owned model runs.
export { buildOptimizeBrief, saveOptimizedCandidate, promoteOptimizedCandidate, OptimizeError } from './specs/optimizeSpec.js';
export type { OptimizeResult } from './specs/optimizeSpec.js';
// LLM-Wiki P3 log — append-only, machine-parseable run history at .hover/log.md.
export { appendWikiLog, readWikiLog, wikiLogPath } from './specs/wikiLog.js';
export type { WikiLogKind, WikiLogEntry } from './specs/wikiLog.js';
// Active-environment marker (.hover/active.json) — the extension writes which
// env is active; the MCP reads it so a drive/heal targets that env's URL.
export { readActiveEnv, writeActiveEnv, activeEnvPath, type ActiveEnv } from './activeEnv.js';
// LLM-Wiki P1 Lint — deterministic health check over .hover/ (map vs specs vs runs).
export { lintWiki, parseRunStatuses } from './specs/lintWiki.js';
export type { LintResult, LintFinding, LintKind, LintSeverity } from './specs/lintWiki.js';
export { parseBusinessMap } from './specs/businessMap.js';
export { declareGuard, type GuardDeclaration } from './specs/declareGuard.js';
export type { BusinessMapGraph, MapNode, MapEdge } from './specs/businessMap.js';
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
// recallMemory = progressive disclosure (full when small, index when large);
// readFact = the on-demand single-rule fetch behind recall_fact.
export { loadMemory, formatMemoryForPrompt, formatMemoryIndex, recallMemory, readFact, formatFact, writeFact, memoryDir } from './memory/businessMemory.js';
export type { BusinessFact } from './memory/businessMemory.js';
export { ensureKnowledgeTracked } from './memory/gitignore.js';

// ── QA intensity (step budget; parked until wired into the workflow) ──────────
export { QA_INTENSITY, DEFAULT_QA_INTENSITY, asQaIntensity, qaBudgetDirective } from './qa/intensity.js';
export type { QaIntensity, QaIntensitySpec } from './qa/intensity.js';
