import type { ProbeRequest } from './types.js';

const SENSITIVE_HEADERS = [
  'cookie', 'set-cookie', 'authorization', 'proxy-authorization',
  'x-api-key', 'x-auth-token', 'x-amz-security-token',
];
// Single source of credential-naming alternatives — both the URL-param and the
// JSON-body matchers derive from it so their coverage can never drift (they did:
// `auth` and `apikey` were in the URL list but missing from the body list, so a
// body field named `auth` leaked into committed specs).
const CREDENTIAL_NAME =
  'password|passwd|token|secret|api[_-]?key|apikey|authorization|access[_-]?token|auth|ssn|credit[_-]?card';
// A query-param/JSON key that names a credential.
const SENSITIVE_KEY = new RegExp(`^(?:${CREDENTIAL_NAME})$`, 'i');
// Match `"<credential>": <value>` for ANY JSON value type — string, number,
// boolean, or null. A string value is `(?:[^"\\]|\\.)*` (escaped-quote-safe so
// `"it\"s"` doesn't truncate). Numbers MUST be redacted too: an SSN or
// credit-card sent as a JSON number (`"ssn":123456789`) previously slipped
// through the string-only matcher straight into the committed spec.
const SENSITIVE_BODY_KEY = new RegExp(
  `"(${CREDENTIAL_NAME})"\\s*:\\s*(?:"(?:[^"\\\\]|\\\\.)*"|-?\\d[\\d.eE+-]*|true|false|null)`,
  'gi',
);

export interface SanitizedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string | null;
  /** Lower-cased names of headers/fields that were stripped or masked. */
  redactions: string[];
}

/**
 * Strip credentials + obvious secrets from a captured request before it goes
 * into a COMMITTED `.api-test.spec.ts`. Real cookies/tokens/PII must never be
 * baked into a test file — CI auth comes from a Playwright `storageState`
 * fixture, not inline.
 */
export function sanitizeRequest(req: ProbeRequest): SanitizedRequest {
  const redactions: string[] = [];

  // Headers: drop credential-bearing ones entirely.
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (SENSITIVE_HEADERS.includes(k.toLowerCase())) {
      redactions.push(k.toLowerCase());
      continue; // drop — credentials come from the fixture
    }
    headers[k] = v;
  }

  // URL: mask credential-looking query-string values (a common token leak).
  const url = sanitizeUrl(req.url, redactions);

  // Body: mask sensitive JSON string fields, keeping the rest intact.
  let bodyText = req.bodyText;
  if (bodyText) {
    bodyText = bodyText.replace(SENSITIVE_BODY_KEY, (_m, key: string) => {
      redactions.push(key.toLowerCase());
      return `"${key}":"<redacted>"`;
    });
  }

  return { method: req.method, url, headers, bodyText, redactions };
}

/** Mask query-param values whose key looks like a credential. Leaves the URL
 *  untouched (byte-identical) when it doesn't parse or nothing matched.
 *
 *  We mutate the sensitive `key=value` segments IN PLACE on the original
 *  string rather than round-tripping through `URL`/`URLSearchParams`. The
 *  round-trip re-serialises the whole query and silently rewrites unrelated
 *  params (`arr[]=1` → `arr%5B%5D=1`, `a+b` normalised), so the committed spec
 *  would replay a subtly different URL. `URL` is still used only to detect a
 *  parseable absolute URL and to discover which param keys are present. */
function sanitizeUrl(raw: string, redactions: string[]): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw; // relative or malformed — nothing safe to do
  }
  for (const key of new Set(u.searchParams.keys())) {
    if (!SENSITIVE_KEY.test(key)) continue;
    // Replace every `key=<value>` segment for this key in the original query
    // string, matching the key exactly as it appears (it has no regex-special
    // chars when it's a credential name, but escape defensively) and leaving
    // all other params byte-identical.
    const keyPattern = new RegExp(`([?&])${escapeRegExp(key)}=[^&#]*`, 'g');
    let matchedKey = false;
    raw = raw.replace(keyPattern, (_m, sep: string) => {
      matchedKey = true;
      return `${sep}${key}=REDACTED`;
    });
    if (matchedKey) redactions.push(key.toLowerCase());
  }
  return raw;
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
