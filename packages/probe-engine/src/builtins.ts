import type { SecuritySeed } from './seed.js';

/**
 * Built-in security-probe recipes that ship with the engine, so `suggestProbes`
 * works out of the box without the user copying anything into `.hover/rules/`.
 * A curated subset of the community `hover-seeds` security set — the ones that
 * match on request shape alone. User seeds (loaded from `.hover/rules/` via
 * `loadSecuritySeeds`) augment these once devRoot plumbing lands.
 */
export const builtinSecuritySeeds: SecuritySeed[] = [
  {
    name: 'idor-numeric-id',
    class: 'idor',
    note: 'Numeric object-reference id in the URL — replay identity A\'s request as identity B and walk the id.',
    match: { method: ['GET', 'PUT', 'PATCH', 'DELETE'], urlParam: '[?&](id|user_id|account|order|invoice)=\\d+', needsAuth: true },
    probe: { strategy: 'Replay under identity B with the id pointing at A\'s resource; also ±1 the numeric id.', secondIdentity: true, destructive: false, signal: 'B receives 200 with A\'s data where 403/404 is expected.' },
  },
  {
    name: 'idor-in-body',
    class: 'idor',
    note: 'Object reference in the JSON body, not the URL.',
    match: { method: ['POST', 'PUT', 'PATCH', 'DELETE'], bodyField: '(user|account|order|invoice|customer|owner)(_?id|Id)', needsAuth: true },
    probe: { strategy: 'Replay under identity B with the body\'s object id pointing at A\'s resource.', secondIdentity: true, destructive: false, signal: 'An identity acts on another identity\'s object by changing an id in the body.' },
  },
  {
    name: 'bfla-privileged-endpoint',
    class: 'bfla',
    note: 'Admin/privileged endpoint that may check auth but not role.',
    match: { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], urlParam: '/(admin|internal|manage|console)', needsAuth: true },
    probe: { strategy: 'Replay verbatim with a low-privilege identity\'s session; expect 403.', secondIdentity: true, destructive: false, signal: 'A low-privilege identity invokes an admin-only endpoint (200 instead of 403).' },
  },
  {
    name: 'mass-assignment-privileged-field',
    class: 'mass-assignment',
    note: 'A write endpoint that may bind the body straight onto the model.',
    match: { method: ['POST', 'PUT', 'PATCH'], needsAuth: true },
    probe: { strategy: 'Add a privileged key the UI never sends (role:"admin", isAdmin:true, verified:true); re-fetch and check it took effect.', secondIdentity: false, destructive: true, signal: 'A privileged field set only via the API persists on re-fetch.' },
  },
  {
    name: 'ssrf-url-param',
    class: 'ssrf',
    note: 'A param that makes the server fetch a URL.',
    match: { method: ['GET', 'POST', 'PUT'], urlParam: '[?&](url|uri|next|redirect|callback|target|image_url|webhook)=', needsAuth: true },
    probe: { strategy: 'Point the value at internal targets (127.0.0.1, 169.254.169.254 metadata) and bypass encodings.', secondIdentity: false, destructive: false, signal: 'The server fetches an internal/metadata URL it should refuse.' },
  },
  {
    name: 'auth-bypass-missing-check',
    class: 'auth-bypass',
    note: 'A protected endpoint that may not verify the session server-side.',
    match: { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], needsAuth: true },
    probe: { strategy: 'Replay with the credential stripped (no cookie / no Authorization), then tampered/alg:none for JWTs.', secondIdentity: false, destructive: false, signal: 'A protected endpoint returns data with no valid credential (200 instead of 401).' },
  },
];
