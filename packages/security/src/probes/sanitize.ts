import type { FlowRequest } from '../mitm/flows.js';

const SENSITIVE_HEADERS = ['cookie', 'set-cookie', 'authorization', 'x-api-key', 'x-auth-token'];
const SENSITIVE_BODY_KEY =
  /"(password|passwd|token|secret|api[_-]?key|authorization|ssn|credit[_-]?card)"\s*:\s*"[^"]*"/gi;

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
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (SENSITIVE_HEADERS.includes(k.toLowerCase())) {
      redactions.push(k.toLowerCase());
      continue; // drop — credentials come from the fixture
    }
    headers[k] = v;
  }
  let bodyText = req.bodyText;
  if (bodyText) {
    bodyText = bodyText.replace(SENSITIVE_BODY_KEY, (_m, key: string) => {
      redactions.push(key.toLowerCase());
      return `"${key}":"<redacted>"`;
    });
  }
  return { method: req.method, url: req.url, headers, bodyText, redactions };
}
