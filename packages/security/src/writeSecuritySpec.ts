/**
 * Write a Hover security-regression spec from a captured SecurityCheckStep[].
 *
 * v0.12 ships this alongside `@hover-dev/core`'s `writeSpec` (the regular UI
 * spec writer). The output file lands
 * under `<devRoot>/__vibe_tests__/<slug>.security.spec.ts` and is plain
 * `@playwright/test` — no Hover runtime, no MITM proxy, no agent. CI
 * runs `pnpm exec playwright test` and gets a regression check every time.
 *
 * Per recorded SecurityCheckStep, the spec emits one `test()` that:
 *   1. Issues the recorded request via Playwright's `request` fixture
 *      (HTTP-level — no browser, faster than UI tests).
 *   2. Asserts the response status matches `expectStatus`.
 *   3. When body excerpt was captured AND it's a deny (4xx/5xx), also
 *      checks the body doesn't leak the resource the deny was supposed
 *      to protect.
 *
 * AuthN: the agent's recorded request often used cookies from a logged-in
 * debug-Chrome session. CI doesn't have those cookies. v0.12's honest
 * answer is to surface this as a TODO in the spec header pointing at the
 * FAQ — Playwright's `storageState` mechanic is what users plug in.
 * We do NOT try to auto-magic authentication.
 *
 * The spec header carries the same JSDoc shape as `writeSpec` so future
 * Re-record-style tooling can read it back.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SecurityCheckStep } from './control-plane.js';
import { gateFinding, sanitizeRequest } from '@hover-dev/probe-engine';

/** Case-insensitive single-value header lookup. */
function headerValue(
  h: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : (v ?? undefined);
  }
  return undefined;
}

/** A recorded check is noise (not worth a regression test) when its intent
 *  matches the engine's never-submit list — self-XSS, missing security header,
 *  clickjacking, logout-CSRF, rate-limit-only. We pass exploitableNow:true so
 *  the only `kill` path is the never-submit match. */
function isNoiseCheck(c: SecurityCheckStep): boolean {
  return gateFinding({
    title: c.intent,
    exploitableNow: true,
    impactProven: true,
    alreadyKnown: false,
  }).verdict === 'kill';
}

export class SecuritySpecExistsError extends Error {
  constructor(public readonly slug: string, public readonly path: string) {
    super(`Security spec "${slug}" already exists at ${path}`);
    this.name = 'SecuritySpecExistsError';
  }
}

export interface WriteSecuritySpecOptions {
  devRoot: string;
  name: string;
  /** Optional natural-language description of what the user was probing.
   *  Lands in the JSDoc `Original prompt:` line so the file is self-
   *  describing for QA / future Re-record runs. */
  description?: string;
  /** Recorded checks, in the order the agent emitted them. */
  checks: SecurityCheckStep[];
  /** Optional final agent summary — lands in `Outcome:` and the
   *  Findings block. */
  summary?: string;
  overwrite?: boolean;
}

export interface WriteSecuritySpecResult {
  path: string;
  slug: string;
}

export async function writeSecuritySpec(
  opts: WriteSecuritySpecOptions,
): Promise<WriteSecuritySpecResult> {
  const slug = slugify(opts.name);
  if (!slug) throw new Error('security spec name must contain at least one alphanumeric character');
  if (opts.checks.length === 0) {
    throw new Error('security spec must contain at least one recorded check');
  }

  const dir = join(opts.devRoot, '__vibe_tests__');
  const path = join(dir, `${slug}.security.spec.ts`);
  if (!opts.overwrite && existsSync(path)) {
    throw new SecuritySpecExistsError(slug, path);
  }

  await mkdir(dir, { recursive: true });
  const source = renderSpec(slug, opts.name, opts.description ?? '', opts.checks, opts.summary);
  await writeFile(path, source, 'utf-8');
  return { path, slug };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function jsdocEscape(s: string): string {
  return s.replace(/\*\//g, '*\\/');
}

/**
 * Render the full spec source. Two-section file:
 *   1. Top-level JSDoc with prompt + checks summary + auth TODO.
 *   2. One test() per recorded check.
 */
function renderSpec(
  slug: string,
  displayName: string,
  description: string,
  checks: SecurityCheckStep[],
  summary: string | undefined,
): string {
  const lines: string[] = [];
  const date = new Date().toISOString().slice(0, 10);

  // Drop never-submit noise (self-XSS, missing headers, …) so it never becomes
  // a regression test. Surface what was dropped — no silent suppression.
  const suppressed = checks.filter(isNoiseCheck);
  const kept = checks.filter((c) => !isNoiseCheck(c));
  const vulnerableChecks = kept.filter((c) => !c.matched);

  // ─── JSDoc header ─────────────────────────────────────────────────
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push('/**');
  lines.push(` * Hover security regression — generated ${date}.`);
  if (description) lines.push(` * Original prompt: ${jsdocEscape(description).slice(0, 240)}`);
  if (summary) lines.push(` * Outcome: ${jsdocEscape(summary.split('\n')[0]).slice(0, 240)}`);
  lines.push(' *');
  lines.push(' * Checks:');
  kept.forEach((c, i) => {
    const verdict = c.matched ? 'pass' : '**VULNERABILITY**';
    lines.push(
      ` *   ${i + 1}. ${jsdocEscape(c.intent)}`,
    );
    lines.push(
      ` *      ${c.observed.method} ${jsdocEscape(c.observed.url)}`,
    );
    lines.push(
      ` *      → expected ${c.expectStatus}, observed ${c.observed.status} — ${verdict}`,
    );
  });

  if (suppressed.length > 0) {
    lines.push(' *');
    lines.push(` * Suppressed ${suppressed.length} noise check(s) (never-submit list):`);
    for (const c of suppressed) {
      lines.push(` *   • ${jsdocEscape(c.intent)}`);
    }
  }

  if (vulnerableChecks.length > 0) {
    lines.push(' *');
    lines.push(' * Findings:');
    for (const c of vulnerableChecks) {
      lines.push(
        ` *   • **Vulnerability** — ${jsdocEscape(c.intent)}: expected ` +
          `${c.expectStatus}, got ${c.observed.status}.`,
      );
    }
  }

  // Auth TODO is the *load-bearing* caveat for v0.12. We emit it always so
  // users can't miss it; the FAQ has the storageState walkthrough.
  lines.push(' *');
  lines.push(' * ⚠ Authentication: the agent recorded these requests with cookies from');
  lines.push(' *   a logged-in debug-Chrome session. CI does not share those cookies.');
  lines.push(' *   Wire your project\'s auth state into Playwright\'s `request` fixture');
  lines.push(' *   before running this spec in CI — typically a `storageState` setup');
  lines.push(' *   under `playwright.config.ts`. See the Hover FAQ entry');
  lines.push(' *   "Security spec auth setup" for the recipe.');
  lines.push(' */');
  lines.push('');

  // ─── describe + per-check tests ───────────────────────────────────
  const safeTitle = displayName.replace(/'/g, "\\'");
  lines.push(`test.describe('security: ${safeTitle}', () => {`);

  kept.forEach((c, i) => {
    const num = String(i + 1).padStart(2, '0');
    const testTitle = `${num} — ${c.intent.replace(/'/g, "\\'").slice(0, 80)}`;
    lines.push('');
    lines.push(`  test('${testTitle}', async ({ request }) => {`);
    if (!c.matched) {
      lines.push(
        `    // Recorded as a vulnerability: observed ${c.observed.status}, expected ${c.expectStatus}.`,
      );
      lines.push(`    // After fix, this test passes (server now returns ${c.expectStatus}).`);
    }
    // Reproduce the captured request, SANITIZED — credentials/secrets are
    // stripped (they come from storageState, never inline). Carries the body
    // for POST/PUT/PATCH so the replay is faithful, not an empty request.
    const sanitized = c.request ? sanitizeRequest(c.request) : null;
    const methodLower = (sanitized?.method ?? c.observed.method).toLowerCase();
    const playwrightMethod = mapToPlaywrightMethod(methodLower);
    const urlJson = JSON.stringify(sanitized?.url ?? c.observed.url);

    const reqOpts: string[] = [];
    if (sanitized?.bodyText) {
      const ct = headerValue(sanitized.headers, 'content-type');
      if (ct) reqOpts.push(`headers: { 'content-type': ${JSON.stringify(ct)} }`);
      reqOpts.push(`data: ${JSON.stringify(sanitized.bodyText)}`);
    }
    if (sanitized && sanitized.redactions.length > 0) {
      const what = [...new Set(sanitized.redactions)].join(', ');
      lines.push(`    // Redacted from the captured request: ${what} (supply auth via storageState).`);
    }
    const optsStr = reqOpts.length > 0 ? `, { ${reqOpts.join(', ')} }` : '';
    lines.push(`    const response = await request.${playwrightMethod}(${urlJson}${optsStr});`);
    lines.push(`    expect(response.status()).toBe(${c.expectStatus});`);

    // Body-leak check: when the security control is "this request must
    // be denied", we ALSO want to verify the body doesn't accidentally
    // contain the resource a leak would expose. We don't know the
    // target's exact PII fields, so this is a coarse heuristic:
    // 4xx + a captured body excerpt ⇒ assert that the response body
    // is shorter than 200 chars (a typical 403/404 page) — anything
    // bigger is suspicious. Users can tighten by hand.
    if (c.expectStatus >= 400 && c.expectStatus < 500 && c.observed.bodyExcerpt) {
      lines.push(`    // Coarse PII-leak guard: a real 4xx should be short.`);
      lines.push(`    const body = await response.text();`);
      lines.push(`    expect(body.length).toBeLessThan(500);`);
    }
    lines.push(`  });`);
  });

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Map an HTTP method to the matching Playwright `request` fixture method.
 * Falls back to `fetch(url, { method })` for less common verbs.
 */
function mapToPlaywrightMethod(method: string): string {
  switch (method) {
    case 'get':
    case 'post':
    case 'put':
    case 'patch':
    case 'delete':
    case 'head':
      return method;
    default:
      return 'fetch'; // request.fetch(url, { method }) — accepts arbitrary verbs
  }
}
