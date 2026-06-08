import type { SecuritySeed } from './seed.js';

/**
 * Built-in probe recipes that ship with the engine. Each is tagged `category`:
 * `authz` (business/access-control — orange security mode) or `vuln`
 * (attack/exploit — red pentest mode). A curated subset of the community
 * `hover-seeds` set + offensive web-vuln methodology adapted from
 * Claude-BugHunter (MIT). User seeds from `.hover/rules/` augment these.
 */
export const builtinSecuritySeeds: SecuritySeed[] = [
  // ── authz (security mode) ──────────────────────────────────────────────
  {
    name: 'idor-numeric-id',
    class: 'idor',
    category: 'authz',
    note: 'Numeric object-reference id in the URL — replay identity A\'s request as identity B and walk the id.',
    match: { method: ['GET', 'PUT', 'PATCH', 'DELETE'], urlParam: '[?&](id|user_id|account|order|invoice)=\\d+', needsAuth: true },
    probe: { strategy: 'Replay under identity B with the id pointing at A\'s resource; also ±1 the numeric id.', secondIdentity: true, destructive: false, signal: 'B receives 200 with A\'s data where 403/404 is expected.' },
  },
  {
    name: 'idor-in-body',
    class: 'idor',
    category: 'authz',
    note: 'Object reference in the JSON body, not the URL.',
    match: { method: ['POST', 'PUT', 'PATCH', 'DELETE'], bodyField: '(user|account|order|invoice|customer|owner)(_?id|Id)', needsAuth: true },
    probe: { strategy: 'Replay under identity B with the body\'s object id pointing at A\'s resource.', secondIdentity: true, destructive: false, signal: 'An identity acts on another identity\'s object by changing an id in the body.' },
  },
  {
    name: 'bfla-privileged-endpoint',
    class: 'bfla',
    category: 'authz',
    note: 'Admin/privileged endpoint that may check auth but not role.',
    match: { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], urlParam: '/(admin|internal|manage|console)', needsAuth: true },
    probe: { strategy: 'Replay verbatim with a low-privilege identity\'s session; expect 403.', secondIdentity: true, destructive: false, signal: 'A low-privilege identity invokes an admin-only endpoint (200 instead of 403).' },
  },
  {
    name: 'mass-assignment-privileged-field',
    class: 'mass-assignment',
    category: 'authz',
    note: 'A write endpoint that may bind the body straight onto the model.',
    match: { method: ['POST', 'PUT', 'PATCH'], needsAuth: true },
    probe: { strategy: 'Add a privileged key the UI never sends (role:"admin", isAdmin:true, verified:true); re-fetch and check it took effect.', secondIdentity: false, destructive: true, signal: 'A privileged field set only via the API persists on re-fetch.' },
  },
  {
    name: 'auth-bypass-missing-check',
    class: 'auth-bypass',
    category: 'authz',
    note: 'A protected endpoint that may not verify the session server-side.',
    match: { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], needsAuth: true },
    probe: { strategy: 'Replay with the credential stripped (no cookie / no Authorization), then tampered/alg:none for JWTs.', secondIdentity: false, destructive: false, signal: 'A protected endpoint returns data with no valid credential (200 instead of 401).' },
  },

  // ── vuln (pentest mode) — offensive web-vuln classes ───────────────────
  {
    name: 'ssrf-url-param',
    class: 'ssrf',
    category: 'vuln',
    note: 'A param that makes the server fetch a URL.',
    match: { method: ['GET', 'POST', 'PUT'], urlParam: '[?&](url|uri|next|redirect|callback|target|image_url|webhook)=', needsAuth: true },
    probe: { strategy: 'Point the value at internal targets (127.0.0.1, 169.254.169.254 metadata, internal ports); confirm IN-BAND via reflected internal content or a timing delta — no external OOB callback.', secondIdentity: false, destructive: false, signal: 'The server returns internal/metadata content it should refuse, or a clear timing delta to an internal host.' },
  },
  {
    name: 'sqli-error-boolean',
    class: 'sqli',
    category: 'vuln',
    note: 'A parameter concatenated into a DB query.',
    match: { method: ['GET', 'POST'], urlParam: "[?&](id|q|search|sort|order|category|filter)=", needsAuth: false },
    probe: { strategy: "Insert a single quote (') for an error/diff; confirm with a boolean pair (' AND 1=1-- vs ' AND 1=2--) by diffing the body, and a time pair (' AND SLEEP(5)--) by the response delay. In-band only.", secondIdentity: false, destructive: false, signal: 'A DB error fragment, a stable boolean body-diff, or a >5s delay on the SLEEP payload.' },
  },
  {
    name: 'xss-reflected',
    class: 'xss',
    category: 'vuln',
    note: 'A parameter reflected into the HTML response.',
    match: { method: ['GET', 'POST'], urlParam: '[?&](q|search|name|message|redirect|lang|ref)=', needsAuth: false },
    probe: { strategy: 'Send a unique random canary (e.g. hovxss9q2k); if it reflects unencoded, escalate to a context-appropriate payload (<svg onload=...>, attribute breakout). Confirm by the marker appearing executable/unencoded in the response.', secondIdentity: false, destructive: false, signal: 'The canary appears unencoded in an executable HTML context.' },
  },
  {
    name: 'ssti-template-injection',
    class: 'ssti',
    category: 'vuln',
    note: 'A user-controlled value rendered through a server template engine.',
    match: { method: ['GET', 'POST'], urlParam: '[?&](name|template|page|q|greeting)=', needsAuth: false },
    probe: { strategy: 'Send {{7*7}} / ${7*7} / #{7*7}; if the response contains 49, fingerprint the engine ({{7*\'7\'}} → 7777777 = Jinja2, 49 = Twig) and, in pentest mode only, attempt the engine\'s class-walker to confirm RCE (read `id`). In-band confirmation.', secondIdentity: false, destructive: false, signal: 'A math expression evaluates in the response (49), or command output appears.' },
  },
];
