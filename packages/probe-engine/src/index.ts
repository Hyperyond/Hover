/**
 * `@hover-dev/probe-engine` — the shared, deterministic foundation for
 * access-control probing. Private + never published; inlined into
 * `@hover-dev/security` (crystallize → spec) and the pentest plugin (sweep →
 * report) via each consumer's tsup `noExternal`. Zero external dependencies.
 */
export type { ProbeRequest, ProbeFlow } from './types.js';
export {
  type SecurityClass,
  type SecuritySeed,
  isSecuritySeed,
  loadSecuritySeeds,
} from './seed.js';
export { hasAuth, matchesFlow, matchSeeds } from './match.js';
export { type SanitizedRequest, sanitizeRequest } from './sanitize.js';
export { type Verdict, type FindingSignals, type GateResult, NEVER_SUBMIT, gateFinding } from './gate.js';
