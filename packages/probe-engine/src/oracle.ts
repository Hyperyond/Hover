/**
 * The BOLA / authorization judgment oracle — the deterministic adjudicator that
 * turns three replayed responses into a confidence-graded verdict. This is the
 * piece that decides the false-positive rate: replaying a request as another
 * identity is easy; deciding whether the 2xx that came back is an *actual*
 * authorization leak (vs. public data, vs. a soft denial that returns 200 + an
 * empty body) is the hard part.
 *
 * Pure functions, zero I/O, zero consumer dependency — lives next to `gate.ts`
 * and `match.ts`. Producing the three responses is the replay path's job
 * (`@hover-dev/api-test`'s `replayFlow` + the storageState identity swap); this
 * module only consumes them.
 *
 * Implements the three-way matrix from the security-direction design (§4.5):
 *
 *   R(A,objA)  baseline   A reads its own object  — should be 2xx
 *   R(A,objB)  attack     A reads B's object      — should be denied
 *   R(B,objB)  reference  B reads its own object  — 2xx; what B's data looks like
 *
 * Design inference (not a citation): the thresholds and similarity heuristic
 * below are first-cut and meant to be tuned against real apps.
 */

/** A confidence-graded verdict. Only `confirmed` is allowed to crystallize into
 *  a `.api-test.spec.ts` CI gate (see `crystallizable`); everything else is
 *  report-only, so a false positive can never turn a build red. */
export type AuthzVerdict =
  /** Unauthorized access proven: A read B's private data. → crystallize. */
  | 'confirmed'
  /** Suspected but unproven (e.g. could be public data) — needs white-box
   *  `read_source` review before it can be promoted. → report only. */
  | 'likely'
  /** The control held: the attack was denied (hard or soft). → report only. */
  | 'secure'
  /** Not enough signal to decide (missing baseline/reference, no B marker). */
  | 'uncertain'
  /** Could not be safely tested (e.g. a write probe with no seedable throwaway
   *  object). Set by the caller's seeding logic, surfaced here for a uniform
   *  verdict vocabulary. → report only. */
  | 'not-tested';

/** The minimal shape of one replay result the oracle reasons about. A richer
 *  flow/response type is structurally compatible — pass `{ status, bodyText }`. */
export interface OracleResponse {
  status: number;
  /** Response body as UTF-8 text; null if binary/empty. */
  bodyText: string | null;
}

export interface AdjudicateInput {
  /** R(A,objA) — A reads its own object. Establishes "A's normal view". */
  baseline: OracleResponse;
  /** R(A,objB) — A reads B's object. The attack under test. */
  attack: OracleResponse;
  /** R(B,objB) — B reads its own object. Establishes "what B's data looks
   *  like", so a leak can be matched against it. */
  reference: OracleResponse;
  /** B's identifiable markers that must NOT appear in A's response: B's object
   *  id, primary key, email, or other PII tokens. Empty strings are ignored.
   *  Presence of any one is the strongest single leak signal. */
  bMarkers: string[];
}

export interface AdjudicateResult {
  verdict: AuthzVerdict;
  /** The intermediate signals, exposed for transparency and for the white-box
   *  confirmation step (§4.7) to explain *why* a verdict landed where it did. */
  signals: {
    attackStatus: number;
    /** Token-similarity of the attack response to B's reference, in [0,1]. */
    simToReference: number;
    /** Token-similarity of the attack response to A's own baseline, in [0,1]. */
    simToBaseline: number;
    /** Does the attack response carry one of B's markers? */
    hasBMarker: boolean;
    /** Does the attack response differ enough from A's baseline to rule out
     *  "public data A would see anyway"? */
    differsFromBaseline: boolean;
    /** Empty / generic body — the soft-denial tell. */
    emptyOrGeneric: boolean;
  };
  reasons: string[];
}

/** Statuses that count as a hard denial of the attack request. */
export const DENY_STATUSES: readonly number[] = [401, 403, 404];

/** A response body at or below this length with no B marker is treated as a
 *  generic / soft-denial body rather than a leak. */
export const GENERIC_BODY_MAX_LEN = 64;

/** Token-similarity ≥ this counts as "the same data". Design-inference default. */
export const HIGH_SIMILARITY = 0.6;

/** The attack must differ from A's own baseline by more than this (i.e. token
 *  similarity below `1 - DIFF_THRESHOLD`) to rule out public data. */
export const DIFF_THRESHOLD = 0.3;

function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Split a body into a de-duplicated set of comparable tokens. Value-sensitive
 *  on purpose: two users' objects share structure but differ in *values* (ids,
 *  names, emails), so token overlap separates "B's data" from "A's data" and
 *  from "public data" alike. */
export function tokenize(body: string | null): Set<string> {
  if (!body) return new Set();
  const matches = body.toLowerCase().match(/[a-z0-9_@.:/-]+/g);
  return new Set(matches ?? []);
}

/**
 * Token-set Jaccard similarity of two bodies, in [0,1]. Two empty bodies are
 * identical (1); one empty against one non-empty is fully dissimilar (0).
 * Deterministic and explainable — no embeddings, no randomness.
 */
export function bodySimilarity(a: string | null, b: string | null): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Does the body contain any of B's identifying markers? Empty/whitespace
 *  markers are ignored so a misconfigured marker can't force a false signal. */
export function containsBMarker(body: string | null, markers: string[]): boolean {
  if (!body) return false;
  return markers.some(m => {
    const needle = m.trim();
    return needle.length > 0 && body.includes(needle);
  });
}

/** A short/empty body with no B marker — the soft-denial tell (200 + `{}` /
 *  `[]` / `null` / a terse error). */
function isEmptyOrGeneric(body: string | null, hasBMarker: boolean): boolean {
  if (hasBMarker) return false;
  const trimmed = (body ?? '').trim();
  return trimmed.length <= GENERIC_BODY_MAX_LEN;
}

/**
 * Adjudicate one BOLA attempt from its three responses. Implements §4.5's
 * pseudocode exactly. Pure.
 */
export function adjudicate(input: AdjudicateInput): AdjudicateResult {
  const { baseline, attack, reference, bMarkers } = input;

  const hasBMarker = containsBMarker(attack.bodyText, bMarkers);
  const simToReference = bodySimilarity(attack.bodyText, reference.bodyText);
  const simToBaseline = bodySimilarity(attack.bodyText, baseline.bodyText);
  const differsFromBaseline = 1 - simToBaseline > DIFF_THRESHOLD;
  const emptyOrGeneric = isEmptyOrGeneric(attack.bodyText, hasBMarker);

  const signals: AdjudicateResult['signals'] = {
    attackStatus: attack.status,
    simToReference,
    simToBaseline,
    hasBMarker,
    differsFromBaseline,
    emptyOrGeneric,
  };

  const result = (verdict: AuthzVerdict, ...reasons: string[]): AdjudicateResult => ({
    verdict,
    signals,
    reasons,
  });

  // Hard denial — the control did its job.
  if (DENY_STATUSES.includes(attack.status)) {
    return result('secure', `attack denied with status ${attack.status}`);
  }

  // Anything other than a clean 2xx is ambiguous: a 5xx, a redirect, a 0
  // (network failure) tells us nothing about authorization.
  if (!is2xx(attack.status)) {
    return result('uncertain', `attack returned non-2xx, non-deny status ${attack.status}`);
  }

  // From here the attack is a 2xx — the interesting case. We need the reference
  // (R_BB) to know what B's data looks like; without a 2xx reference we cannot
  // tell a leak from a coincidence.
  if (!is2xx(reference.status)) {
    return result('uncertain', `reference R(B,objB) not 2xx (status ${reference.status}); cannot establish B's data`);
  }

  const highSim = simToReference >= HIGH_SIMILARITY;

  if (highSim && hasBMarker && differsFromBaseline) {
    return result(
      'confirmed',
      `attack body matches B's reference (sim ${simToReference.toFixed(2)} ≥ ${HIGH_SIMILARITY})`,
      `carries B's marker`,
      `differs from A's own baseline (sim ${simToBaseline.toFixed(2)}) — not public data`,
    );
  }

  if (highSim && hasBMarker) {
    return result(
      'likely',
      `attack body matches B's reference and carries B's marker`,
      `but is similar to A's own baseline (sim ${simToBaseline.toFixed(2)}) — could be public/shared data; needs white-box review`,
    );
  }

  if (emptyOrGeneric) {
    return result('secure', `2xx but empty/generic body (≤ ${GENERIC_BODY_MAX_LEN} chars, no B marker) — soft denial`);
  }

  return result('uncertain', `2xx but no decisive leak signal (sim-to-reference ${simToReference.toFixed(2)}, B marker ${hasBMarker})`);
}

/** Only a `confirmed` verdict is allowed to crystallize into a CI gate. */
export function crystallizable(verdict: AuthzVerdict): boolean {
  return verdict === 'confirmed';
}
