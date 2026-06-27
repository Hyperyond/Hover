/**
 * Self-heal Stage 1 — the failure → heal-hint bridge.
 *
 * Playwright's JSON reporter records pass/fail but not *which locator* failed.
 * Self-healing needs that to know what to re-locate. The locator IS in the error
 * message (e.g. `waiting for getByRole('button', { name: 'Submit' })`), so this
 * module parses the run JSON's failed tests and pulls out, per failure, the
 * `getBy…` expression + the action that failed — the hint the heal session
 * (Stage 2) drives the agent with.
 *
 * Pure + total: bad/partial JSON yields []. No FS, no agent — just parsing.
 */

export interface RunFailure {
  /** Spec file as Playwright reports it (path or basename). */
  specFile: string;
  /** Test title. */
  title: string;
  /** First line of the error message (the human-readable failure). */
  error: string;
  /** The `getBy…` locator expression parsed from the error — the thing to
   *  re-locate — or undefined if the failure wasn't a locator miss. */
  failingLocator?: string;
  /** The Playwright action that failed: 'click' / 'fill' / 'assert' / … */
  failingAction?: string;
}

/** A `getBy…(...)` call with an optional `.first()/.last()/.nth()` tail. The
 *  inner `(?:[^()]|\([^()]*\))*` tolerates one level of nested parens so
 *  `getByRole('button', { name: 'x' })` matches whole. */
const LOCATOR_RE = /getBy\w+\((?:[^()]|\([^()]*\))*\)(?:\.(?:first|last|nth)\([^)]*\))?/;
/** A KNOWN Playwright interaction at the head of an error (`locator.click: …`),
 *  restricted to real actions so a generic `Error:` / `Some:` prefix is NOT
 *  mistaken for one. */
const ACTION_RE = /^(?:locator\.)?(click|dblclick|fill|type|press|check|uncheck|selectOption|setInputFiles|hover|tap|focus|clear)\b/;
const ASSERT_RE = /\b(?:toBeVisible|toHaveText|toContainText|toHaveCount|toHaveValue|toBeChecked|toBeEnabled)\b|^expect\(/;

function firstLine(s: string): string {
  return (s.split('\n').find(l => l.trim()) ?? '').trim();
}

/** The `getBy…` expression in an error message, if any. */
export function extractLocator(message: string): string | undefined {
  const m = message.match(LOCATOR_RE);
  return m ? m[0] : undefined;
}

/** The failing action (click / fill / assert / …) inferred from the message. */
export function extractAction(message: string): string | undefined {
  const head = firstLine(message);
  // Assert first — an `Error: expect(...)` line leads with "Error:", which a
  // generic action match would wrongly read as the action.
  if (ASSERT_RE.test(head) || ASSERT_RE.test(message)) return 'assert';
  const m = head.match(ACTION_RE);
  return m ? m[1].toLowerCase() : undefined;
}

interface PwResult { status?: string; error?: { message?: string }; errors?: { message?: string }[] }
interface PwTest { results?: PwResult[] }
interface PwSpec { title?: string; file?: string; ok?: boolean; tests?: PwTest[] }
interface PwSuite { title?: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] }

/** The error message of the first failed/timed-out result on a spec, if any. */
function failedMessage(spec: PwSpec): string | undefined {
  for (const t of spec.tests ?? []) {
    for (const r of t.results ?? []) {
      if (r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted') {
        return r.error?.message || r.errors?.find(e => e.message)?.message || 'Test failed (no error message).';
      }
    }
  }
  return undefined;
}

function walk(suite: PwSuite, fileFallback: string, out: RunFailure[]): void {
  const file = suite.file || fileFallback;
  for (const spec of suite.specs ?? []) {
    if (spec.ok === true) continue;
    const message = failedMessage(spec);
    if (!message) continue; // not a failure (ok may be undefined but no failed result)
    out.push({
      specFile: spec.file || file,
      title: spec.title || '(untitled)',
      error: firstLine(message),
      failingLocator: extractLocator(message),
      failingAction: extractAction(message),
    });
  }
  for (const child of suite.suites ?? []) walk(child, file, out);
}

/** Parse a Playwright JSON-reporter run into its failures (with the failing
 *  locator + action pulled from each error). Accepts the parsed object or a
 *  JSON string; anything malformed yields []. */
export function parseRunFailures(json: unknown): RunFailure[] {
  let root: { suites?: PwSuite[] };
  if (typeof json === 'string') {
    try { root = JSON.parse(json); } catch { return []; }
  } else if (json && typeof json === 'object') {
    root = json as { suites?: PwSuite[] };
  } else {
    return [];
  }
  const out: RunFailure[] = [];
  for (const suite of root.suites ?? []) walk(suite, suite.file || '', out);
  return out;
}
