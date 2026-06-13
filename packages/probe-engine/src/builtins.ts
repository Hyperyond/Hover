import { isSecuritySeed, type SecuritySeed } from './seed.js';

import idorNumericId from '../seeds/idor-numeric-id.json';
import idorInBody from '../seeds/idor-in-body.json';
import idorUuid from '../seeds/idor-uuid.json';
import idorCrossTenant from '../seeds/idor-cross-tenant.json';
import bolaGraphqlNode from '../seeds/bola-graphql-node.json';
import bflaPrivilegedEndpoint from '../seeds/bfla-privileged-endpoint.json';
import massAssignmentPrivilegedField from '../seeds/mass-assignment-privileged-field.json';
import authBypassMissingCheck from '../seeds/auth-bypass-missing-check.json';
import ssrfUrlParam from '../seeds/ssrf-url-param.json';
import sqliErrorBoolean from '../seeds/sqli-error-boolean.json';
import xssReflected from '../seeds/xss-reflected.json';
import sstiTemplateInjection from '../seeds/ssti-template-injection.json';
import openRedirect from '../seeds/open-redirect.json';
import pathTraversal from '../seeds/path-traversal.json';
import graphqlIntrospection from '../seeds/graphql-introspection.json';
import corsReflectedOrigin from '../seeds/cors-reflected-origin.json';
import jwtClaimTamper from '../seeds/jwt-claim-tamper.json';

/**
 * Built-in probe recipes that ship with the engine. Each is a JSON file in
 * `packages/probe-engine/seeds/` tagged `category`: `authz` (business /
 * access-control — orange security mode) or `vuln` (attack / exploit — red
 * pentest mode). The recipes are a curated set adapting offensive web-vuln
 * methodology from Claude-BugHunter (MIT). User seeds from `.hover/rules/`
 * augment these at runtime.
 *
 * Why JSON files + a static-import barrel rather than `.hover/rules/`-style
 * runtime `readdir`: this package is `private` and gets INLINED into
 * `@hover-dev/security` / `@hover-dev/pentest` via tsup `noExternal`, so there
 * is no on-disk `seeds/` directory next to the compiled output to read at
 * runtime. esbuild inlines each JSON import into the consumer bundle, so the
 * recipes travel with the code (no runtime fs read). To add a built-in:
 * drop a JSON file in `seeds/`, import it here, and append it to the array
 * below. End users extend without a rebuild via `<devRoot>/.hover/rules/`.
 *
 * The array is typed `unknown[]` then narrowed by `isSecuritySeed`, so a
 * malformed JSON is dropped at load rather than shipping a broken recipe.
 */
const raw: unknown[] = [
  // ── authz (security mode) ──────────────────────────────────────────────
  idorNumericId,
  idorInBody,
  idorUuid,
  idorCrossTenant,
  bolaGraphqlNode,
  bflaPrivilegedEndpoint,
  massAssignmentPrivilegedField,
  authBypassMissingCheck,
  // ── vuln (pentest mode) — offensive web-vuln classes ───────────────────
  ssrfUrlParam,
  sqliErrorBoolean,
  xssReflected,
  sstiTemplateInjection,
  openRedirect,
  pathTraversal,
  graphqlIntrospection,
  corsReflectedOrigin,
  jwtClaimTamper,
];

export const builtinSecuritySeeds: SecuritySeed[] = raw.filter(isSecuritySeed);
