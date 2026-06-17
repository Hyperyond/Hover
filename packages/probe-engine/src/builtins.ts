import { type SecuritySeed } from './seed.js';

/**
 * Built-in probe recipes that ship with the engine — the entire security /
 * pentest probe catalogue, inlined as data. Each is tagged `category`: `authz`
 * (business / access-control — orange API-testing mode) or `vuln` (attack /
 * exploit — red pentest mode). The set adapts offensive web-vuln methodology
 * from Claude-BugHunter (MIT).
 *
 * These used to be JSON files under `packages/probe-engine/seeds/` plus a
 * `.hover/rules/`-style user-extension mechanism. Both were removed: the JSON
 * round-trip and "author your own seed file" surface added user burden for a
 * catalogue that is curated, security-critical, and not meaningfully
 * end-user-tunable. The knowledge now lives here as code — self-contained, type
 * checked, and travelling with the bundle (this package is inlined into
 * `@hover-dev/api-test` / `@hover-dev/pentest`). To add a probe: append a
 * `SecuritySeed` to the array below.
 */
export const builtinSecuritySeeds: SecuritySeed[] = [
  // ── authz (API-testing mode) ────────────────────────────────────────────────
  {
    name: 'idor-numeric-id',
    class: 'idor',
    category: 'authz',
    note: 'Numeric object-reference id in the URL — replay identity A\'s request as identity B and walk the id.',
    match: {
      method: ['GET', 'PUT', 'PATCH', 'DELETE'],
      urlParam: '[?&](id|user_id|account|order|invoice)=\\d+',
      needsAuth: true,
    },
    probe: {
      strategy: 'Replay under identity B with the id pointing at A\'s resource; also ±1 the numeric id.',
      secondIdentity: true,
      destructive: false,
      signal: 'B receives 200 with A\'s data where 403/404 is expected.',
    },
    assert: 'expect(resAsB.status(), "A\'s resource must not be readable by B").toBeGreaterThanOrEqual(400);',
  },
  {
    name: 'idor-in-body',
    class: 'idor',
    category: 'authz',
    note: 'Object reference in the JSON body, not the URL.',
    match: {
      method: ['POST', 'PUT', 'PATCH', 'DELETE'],
      bodyField: '(user|account|order|invoice|customer|owner)(_?id|Id)',
      needsAuth: true,
    },
    probe: {
      strategy: 'Replay under identity B with the body\'s object id pointing at A\'s resource.',
      secondIdentity: true,
      destructive: false,
      signal: 'An identity acts on another identity\'s object by changing an id in the body.',
    },
    assert: 'expect(resAsOtherUser.status(), \'a body-supplied object id must not cross identities\').toBeGreaterThanOrEqual(400);',
  },
  {
    name: 'idor-uuid',
    class: 'idor',
    category: 'authz',
    note: 'Object reference is a UUID/GUID, not a sequential id. You can\'t increment it — harvest other identities\' UUIDs from list/search/feed/notification responses, then replay identity A\'s request with a harvested id.',
    match: {
      method: ['GET', 'PUT', 'PATCH', 'DELETE'],
      urlParam: '[?&/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
      needsAuth: true,
    },
    probe: {
      strategy: 'Collect UUIDs that belong to other identities from any list/search/feed response the app exposes. Replay identity A\'s request substituting a UUID owned by B; confirm A cannot read or modify B\'s object. An unguessable id is not authorization.',
      secondIdentity: true,
      destructive: false,
      signal: 'A receives 200 with B\'s object using a harvested UUID, where 403/404 is expected.',
    },
    assert: 'expect(resAsOtherUser.status(), \'a harvested UUID must not grant cross-user access\').toBeGreaterThanOrEqual(400);',
  },
  {
    name: 'idor-cross-tenant',
    class: 'idor',
    category: 'authz',
    note: 'Multi-tenant app: a tenant/org/workspace id scopes the data. With an identity that belongs to tenant A, swap in tenant B\'s id and check for cross-tenant leakage.',
    match: {
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      urlParam: '[?&/](tenant|org|organization|workspace|company|account)(_id|Id)?=',
      needsAuth: true,
    },
    probe: {
      strategy: 'As an identity scoped to tenant A, replay the request with tenant B\'s identifier in the path, query, body, or header. The server must scope by the authenticated session, never by the client-supplied tenant id.',
      secondIdentity: true,
      destructive: false,
      signal: 'Tenant A\'s identity reads or writes tenant B\'s data by changing the tenant id.',
    },
    assert: 'expect(resCrossTenant.status(), \'tenant scoping must come from the session, not a client id\').toBeGreaterThanOrEqual(400);',
  },
  {
    name: 'bola-graphql-node',
    class: 'bola',
    category: 'authz',
    note: 'GraphQL relay node(id:) (or any query taking a global object id) fetches an object by id. Substitute ids belonging to another identity to test object-level authorization.',
    match: {
      method: ['POST'],
      urlParam: '/graphql',
      bodyField: 'node\\s*\\(\\s*id:',
      needsAuth: true,
    },
    probe: {
      strategy: 'Run introspection or read ids from your own results, then issue node(id: "<other-identity-object>") as identity B. Test mutations the same way. Global ids are often base64("Type:123") — decode, walk the numeric tail, re-encode.',
      secondIdentity: true,
      destructive: false,
      signal: 'node(id:) returns another identity\'s object, or a mutation accepts another identity\'s id.',
    },
    assert: 'expect(graphqlAsB.data?.node, \'node(id:) must not resolve another identity object\').toBeNull();',
  },
  {
    name: 'bfla-privileged-endpoint',
    class: 'bfla',
    category: 'authz',
    note: 'Admin/privileged endpoint that may check auth but not role.',
    match: {
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      urlParam: '/(admin|internal|manage|console|settings/(users|roles|billing))',
      needsAuth: true,
    },
    probe: {
      strategy: 'Replay verbatim with a low-privilege identity\'s session; expect 403.',
      secondIdentity: true,
      destructive: false,
      signal: 'A low-privilege identity invokes an admin-only endpoint (200 instead of 403).',
    },
    assert: 'expect(adminEndpointAsLowPriv.status(), \'admin endpoint must enforce role, not just auth\').toBe(403);',
  },
  {
    name: 'mass-assignment-privileged-field',
    class: 'mass-assignment',
    category: 'authz',
    note: 'A write endpoint that may bind the body straight onto the model.',
    match: {
      method: ['POST', 'PUT', 'PATCH'],
      needsAuth: true,
    },
    probe: {
      strategy: 'Add a privileged key the UI never sends (role:"admin", isAdmin:true, verified:true); re-fetch and check it took effect.',
      secondIdentity: false,
      destructive: true,
      signal: 'A privileged field set only via the API persists on re-fetch.',
    },
    assert: 'expect(refetched.role, \'server must ignore client-supplied privileged fields\').not.toBe(\'admin\');',
  },
  {
    name: 'auth-bypass-missing-check',
    class: 'auth-bypass',
    category: 'authz',
    note: 'A protected endpoint that may not verify the session server-side.',
    match: {
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      needsAuth: true,
    },
    probe: {
      strategy: 'Replay with the credential stripped (no cookie / no Authorization), then tampered/alg:none for JWTs.',
      secondIdentity: false,
      destructive: false,
      signal: 'A protected endpoint returns data with no valid credential (200 instead of 401).',
    },
    assert: 'expect(noCredResponse.status(), \'protected endpoint must reject a request with no credential\').toBe(401);',
  },
  // ── vuln (pentest mode) — offensive web-vuln classes ───────────────────────
  {
    name: 'ssrf-url-param',
    class: 'ssrf',
    category: 'vuln',
    note: 'A param that makes the server fetch a URL.',
    match: {
      method: ['GET', 'POST', 'PUT'],
      urlParam: '[?&](url|uri|next|redirect|callback|target|dest|image_url|webhook|feed|src|domain)=',
      needsAuth: true,
    },
    probe: {
      strategy: 'Point the value at internal targets (127.0.0.1, 169.254.169.254 metadata, internal ports); confirm IN-BAND via reflected internal content or a timing delta — no external OOB callback.',
      secondIdentity: false,
      destructive: false,
      signal: 'The server returns internal/metadata content it should refuse, or a clear timing delta to an internal host.',
    },
    assert: 'expect(ssrfProbe.status(), \'server must not fetch internal URLs supplied by the client\').toBeGreaterThanOrEqual(400);',
  },
  {
    name: 'sqli-error-boolean',
    class: 'sqli',
    category: 'vuln',
    note: 'A parameter concatenated into a DB query.',
    match: {
      method: ['GET', 'POST'],
      urlParam: '[?&](id|q|search|sort|order|category|filter)=',
      needsAuth: false,
    },
    probe: {
      strategy: 'Insert a single quote (\') for an error/diff; confirm with a boolean pair (\' AND 1=1-- vs \' AND 1=2--) by diffing the body, and a time pair (\' AND SLEEP(5)--) by the response delay. In-band only.',
      secondIdentity: false,
      destructive: false,
      signal: 'A DB error fragment, a stable boolean body-diff, or a >5s delay on the SLEEP payload.',
    },
  },
  {
    name: 'xss-reflected',
    class: 'xss',
    category: 'vuln',
    note: 'A parameter reflected into the HTML response.',
    match: {
      method: ['GET', 'POST'],
      urlParam: '[?&](q|search|name|message|redirect|lang|ref)=',
      needsAuth: false,
    },
    probe: {
      strategy: 'Send a unique random canary (e.g. hovxss9q2k); if it reflects unencoded, escalate to a context-appropriate payload (<svg onload=...>, attribute breakout). Confirm by the marker appearing executable/unencoded in the response.',
      secondIdentity: false,
      destructive: false,
      signal: 'The canary appears unencoded in an executable HTML context.',
    },
  },
  {
    name: 'ssti-template-injection',
    class: 'ssti',
    category: 'vuln',
    note: 'A user-controlled value rendered through a server template engine.',
    match: {
      method: ['GET', 'POST'],
      urlParam: '[?&](name|template|page|q|greeting)=',
      needsAuth: false,
    },
    probe: {
      strategy: 'Send {{7*7}} / ${7*7} / #{7*7}; if the response contains 49, fingerprint the engine ({{7*\'7\'}} → 7777777 = Jinja2, 49 = Twig) and, in pentest mode only, attempt the engine\'s class-walker to confirm RCE (read `id`). In-band confirmation.',
      secondIdentity: false,
      destructive: false,
      signal: 'A math expression evaluates in the response (49), or command output appears.',
    },
  },
  {
    name: 'open-redirect',
    class: 'open-redirect',
    category: 'vuln',
    note: 'A param that sets a redirect target reflected into a 3xx Location.',
    match: {
      method: ['GET', 'POST'],
      urlParam: '[?&](redirect|redirect_uri|redirect_url|redir|return|returnUrl|returnurl|return_to|next|continue|url|dest|destination|callback|goto|forward|rurl)=',
      needsAuth: false,
    },
    probe: {
      strategy: 'Replace the value with an absolute external origin (https://evil.example) and a protocol-relative //evil.example, with redirects set to manual. Confirm IN-BAND by reading the Location header — no external callback.',
      secondIdentity: false,
      destructive: false,
      signal: 'A 3xx whose Location points at the attacker-controlled external origin.',
    },
    assert: 'expect(new URL(redirectResponse.headers()[\'location\'] ?? \'/\', baseURL).host, \'redirect target must stay on an allow-listed host\').toBe(new URL(baseURL).host);',
  },
  {
    name: 'path-traversal',
    class: 'path-traversal',
    category: 'vuln',
    note: 'A param naming a file/path the server reads back.',
    match: {
      method: ['GET', 'POST'],
      urlParam: '[?&](file|filename|filepath|path|doc|document|download|template|include|attachment|dir|folder|page|lang|locale|view)=',
      needsAuth: false,
    },
    probe: {
      strategy: 'Send ../../../../etc/passwd and an encoded ..%2f variant (Windows: ..\\..\\windows\\win.ini). Confirm IN-BAND by the file contents appearing in the response — do not write or delete anything.',
      secondIdentity: false,
      destructive: false,
      signal: 'Server file contents (e.g. root:x:0:0 from /etc/passwd) appear in the response.',
    },
    assert: 'expect(traversalResponse.status(), \'a path param must not read files outside its directory\').toBeGreaterThanOrEqual(400);',
  },
  {
    name: 'graphql-introspection',
    class: 'graphql',
    category: 'vuln',
    note: 'A GraphQL endpoint that may expose its full schema.',
    match: {
      method: ['GET', 'POST'],
      urlParam: '/graphql',
      needsAuth: false,
    },
    probe: {
      strategy: 'POST the introspection query ({__schema{types{name}}}); if it returns the schema, enumerate mutations/queries the UI never exposes and probe those for missing authz. In-band.',
      secondIdentity: false,
      destructive: false,
      signal: 'Introspection returns the full __schema (types/mutations) that should be disabled in production.',
    },
  },
  {
    name: 'cors-reflected-origin',
    class: 'cors',
    category: 'vuln',
    note: 'An endpoint that reflects the request Origin into Access-Control-Allow-Origin AND allows credentials — any site can then read the authenticated response.',
    match: {
      method: ['GET', 'POST'],
      needsAuth: true,
    },
    probe: {
      strategy: 'Replay the request adding Origin: https://evil.example. Inspect Access-Control-Allow-Origin and Access-Control-Allow-Credentials. Reflecting an arbitrary Origin with credentials:true is exploitable; also try Origin: null and trusted-suffix bypasses (evil-trusted.app).',
      secondIdentity: false,
      destructive: false,
      signal: 'Access-Control-Allow-Origin reflects the attacker Origin while Allow-Credentials is true.',
    },
    assert: 'expect(corsResponse.headers()[\'access-control-allow-origin\'], \'CORS must not reflect an arbitrary Origin\').not.toBe(\'https://evil.example\');',
  },
  {
    name: 'jwt-claim-tamper',
    class: 'jwt',
    category: 'vuln',
    note: 'A JWT/Bearer session whose claims the server may trust without verifying the signature. Tamper a claim (role, sub, tenant) and try the classic signature bypasses.',
    match: {
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      needsAuth: true,
    },
    probe: {
      strategy: 'Decode the JWT and try: alg:none (strip the signature), HS/RS confusion (sign with the public key as the HMAC secret), and editing claims (role:"admin", sub:<other-user>, exp far future) while keeping the original signature to see whether it is checked at all.',
      secondIdentity: false,
      destructive: false,
      signal: 'A request with a tampered, unverified, or alg:none JWT is accepted as the altered identity/role.',
    },
    assert: 'expect(tamperedJwtResponse.status(), \'server must reject a JWT with a tampered or absent signature\').toBeGreaterThanOrEqual(400);',
  },
];
