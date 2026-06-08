import type { SecurityClass } from './seed.js';

/**
 * A vulnerability the agent CONFIRMED by driving the browser — reflected / DOM
 * XSS it watched execute, a client-side injection, an auth/logic flaw triggered
 * through the UI. The replay-based `SecurityCheckStep` only captures HTTP-level
 * probes (replay_flow with intent + expectStatus); attacks confirmed in the page
 * itself produce no replayed request, so they're recorded as this shape instead.
 * Both feed the pentest findings report. Pure data — no runtime dependency.
 */
export interface BrowserFinding {
  /** Monotonic id within the session. */
  id: number;
  /** Vulnerability class, when known — drives the report's impact/recommendation. */
  class?: SecurityClass;
  /** Short human description, e.g. "Reflected XSS in the search field". */
  intent: string;
  /** Agent-assessed severity. Defaults to Medium when the agent omits it. */
  severity: 'High' | 'Medium' | 'Low';
  /** How it was confirmed IN-BAND — the payload sent + the observed effect.
   *  Sanitized by the agent (no real user data). */
  evidence: string;
  /** Where it was found — page URL / field, sanitized. */
  location?: string;
  /** Wall-clock when recorded. */
  recordedAt: number;
}
