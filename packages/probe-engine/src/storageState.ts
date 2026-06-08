/**
 * Read a Playwright `storageState` file's cookies into a `Cookie` request
 * header, so a captured request can be replayed AS a second identity (B) for
 * IDOR / BOLA probing. Pure — the caller does the file read.
 */
export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

export interface StorageState {
  cookies?: StorageStateCookie[];
  origins?: unknown[];
}

/** True if `host` is covered by a cookie `domain` (exact, or a dot-prefixed
 *  parent domain — the standard cookie domain-match). */
function domainMatches(host: string, domain: string): boolean {
  // Leading-dot domain → applies to the domain and its subdomains.
  // No leading dot → host-only cookie, exact match only (RFC 6265).
  if (domain.startsWith('.')) {
    const d = domain.slice(1);
    return host === d || host.endsWith(`.${d}`);
  }
  return host === domain;
}

/**
 * Build a `Cookie` header value from the storageState cookies that apply to
 * `url`'s host. Returns '' when the URL is malformed or no cookie matches.
 */
export function cookieHeaderFor(state: StorageState, url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return '';
  }
  return (state.cookies ?? [])
    .filter(c => domainMatches(host, c.domain))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}
