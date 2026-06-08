import type { FlowRequest } from '../mitm/flows.js';

const SENSITIVE_HEADERS = [
  'cookie', 'set-cookie', 'authorization', 'proxy-authorization',
  'x-api-key', 'x-auth-token', 'x-amz-security-token',
];
// A query-param/JSON key that names a credential.
const SENSITIVE_KEY = /^(password|passwd|token|secret|api[_-]?key|apikey|authorization|access[_-]?token|auth|ssn|credit[_-]?card)$/i;
// JSON string value is `(?:[^"\\]|\\.)*` — escaped-quote-safe so a value like
// "it\"s" doesn't truncate the match and corrupt the surrounding JSON.
const SENSITIVE_BODY_KEY =
  /"(password|passwd|token|secret|api[_-]?key|authorization|access[_-]?token|ssn|credit[_-]?card)"\s*:\s*"(?:[^"\\]|\\.)*"/gi;

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
 * into a COMMITTED `.security.spec.ts`. Real cookies/tokens/PII must never be
 * baked into a test file — CI auth comes from a Playwright `storageState`
 * fixture, not inline.
 */
export function sanitizeRequest(req: FlowRequest): SanitizedRequest {
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
 *  untouched (byte-identical) when it doesn't parse or nothing matched. */
function sanitizeUrl(raw: string, redactions: string[]): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw; // relative or malformed — nothing safe to do
  }
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    if (SENSITIVE_KEY.test(key)) {
      u.searchParams.set(key, 'REDACTED');
      redactions.push(key.toLowerCase());
      changed = true;
    }
  }
  return changed ? u.toString() : raw;
}
