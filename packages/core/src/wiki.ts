/*
 * `@hover-dev/core/wiki` — the pure-read entry over `.hover/` (the app's test
 * wiki): the business-map parser + the Lint health check + the run-history log
 * reader. Everything here transitively imports ONLY `node:fs` / `node:path`
 * (and type-only refs) — no playwright, no ts-morph, no engine.
 *
 * Why a separate entry from `./engine`: a slim consumer (the VS Code cockpit)
 * bundles this to render the wiki, and importing the full engine barrel would
 * drag `playwright-core` + `ts-morph` into its ~220 KB .vsix. This barrel keeps
 * that consumer's bundle tiny while still sharing one source of truth.
 */
export { lintWiki, parseRunStatuses } from './specs/lintWiki.js';
export type { LintResult, LintFinding, LintKind, LintSeverity } from './specs/lintWiki.js';
export { readWikiLog, wikiLogPath } from './specs/wikiLog.js';
export type { WikiLogEntry, WikiLogKind } from './specs/wikiLog.js';
export { parseBusinessMap } from './specs/businessMap.js';
export type { BusinessMapGraph, MapNode, MapEdge, MapRelation, RelationKind, CoverageStatus } from './specs/businessMap.js';
