/**
 * The canonical "recorded security check" shape — one replay the agent did
 * with a stated intent + an expected status. Lives in the engine because it is
 * the shared data contract between the two consumers: `@hover-dev/api-test`
 * (records checks, crystallizes them into a spec) and `@hover-dev/pentest`
 * (renders them into a findings report). Pure data — no runtime dependency.
 */
import type { SecurityClass } from './seed.js';
import type { AuthzVerdict } from './oracle.js';

export interface SecurityCheckStep {
  /** Monotonic id within this session, useful for stable ordering. */
  id: number;
  /** The vulnerability class probed, when known (set by the probe that
   *  produced the check). Lets the report enrich with per-class
   *  impact/recommendation. Optional/back-compat. */
  class?: SecurityClass;
  /** Source flow this check derives from. */
  sourceFlowId: string;
  /** Resulting replayed flow id (the mutation's target). */
  replayId: string;
  /** Agent-supplied human description, e.g. "IDOR: access another user's order". */
  intent: string;
  /** Agent-stated expectation — the status code that proves the control works. */
  expectStatus: number;
  /** The replayed request, so a spec/report can reproduce it faithfully —
   *  sanitized before it lands in any artifact. Optional for back-compat. */
  request?: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    bodyText: string | null;
  };
  /** Set when the replay was issued AS a second identity (B) — that identity's
   *  storageState path. Drives the multi-role spec emit. */
  crossIdentity?: { identityB: string };
  /** What actually came back. */
  observed: {
    method: string;
    url: string;
    status: number;
    statusMessage: string | null;
    bodyExcerpt: string | null;
  };
  /** Whether observed === expected (verified control vs. vulnerability). */
  matched: boolean;
  /** The BOLA/authz judgment oracle's verdict for this check, when it was run
   *  (a cross-identity check the agent adjudicated via the three-way matrix —
   *  see `adjudicate` in oracle.ts). Drives crystallization: only a `confirmed`
   *  verdict is allowed into a `.api-test.spec.ts` CI gate; `likely` /
   *  `uncertain` / `not-tested` stay report-only so a false positive can never
   *  turn a build red. Absent on checks that were never adjudicated (the
   *  status-only checks behave as before). */
  authz?: { verdict: AuthzVerdict; reasons: string[] };
  /** Wall-clock when the check was recorded. */
  recordedAt: number;
}
