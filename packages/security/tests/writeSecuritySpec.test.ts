import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSecuritySpec, SecuritySpecExistsError } from '../src/writeSecuritySpec.js';
import type { SecurityCheckStep } from '../src/control-plane.js';

function buildCheck(overrides: Partial<SecurityCheckStep> = {}): SecurityCheckStep {
  const defaults: SecurityCheckStep = {
    id: 1,
    sourceFlowId: 'abc123',
    replayId: 'def456',
    intent: 'IDOR: access another user\'s order',
    expectStatus: 403,
    observed: {
      method: 'GET',
      url: 'http://localhost:5174/api/orders/999',
      status: 200,
      statusMessage: 'OK',
      bodyExcerpt: '{"id":999,"owner":"someone-else"}',
    },
    matched: false,
    recordedAt: Date.now(),
  };
  return { ...defaults, ...overrides };
}

describe('writeSecuritySpec', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'hover-write-sec-spec-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('refuses empty check list', async () => {
    await expect(
      writeSecuritySpec({ devRoot: tmp, name: 'orders-idor', checks: [] }),
    ).rejects.toThrow(/at least one recorded check/);
  });

  test('refuses name with no alphanumeric content', async () => {
    await expect(
      writeSecuritySpec({ devRoot: tmp, name: '---', checks: [buildCheck()] }),
    ).rejects.toThrow(/at least one alphanumeric character/);
  });

  test('writes to __vibe_tests__/<slug>.security.spec.ts', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'Orders IDOR',
      checks: [buildCheck()],
    });
    expect(result.slug).toBe('orders-idor');
    expect(result.path).toBe(join(tmp, '__vibe_tests__', 'orders-idor.security.spec.ts'));
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain("import { test, expect } from '@playwright/test';");
    expect(src).toContain("test.describe('security: Orders IDOR'");
  });

  test('authz oracle gate: a non-confirmed verdict is report-only, not a test', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'bola gate',
      checks: [
        buildCheck({ id: 1, intent: 'BOLA confirmed leak', authz: { verdict: 'confirmed', reasons: ['carries B marker'] } }),
        buildCheck({ id: 2, intent: 'BOLA likely public data', authz: { verdict: 'likely', reasons: ['similar to A baseline'] } }),
      ],
    });
    const src = readFileSync(result.path, 'utf-8');
    // confirmed → emitted as a test
    expect(src).toContain('BOLA confirmed leak');
    expect(src).toMatch(/test\('01 — BOLA confirmed leak/);
    // likely → report-only header line, never a test() body
    expect(src).toContain('Report-only');
    expect(src).toContain('[likely] BOLA likely public data');
    expect(src).not.toMatch(/test\('0\d — BOLA likely/);
  });

  test('throws SecuritySpecExistsError when overwrite=false and file exists', async () => {
    await writeSecuritySpec({ devRoot: tmp, name: 'flow', checks: [buildCheck()] });
    await expect(
      writeSecuritySpec({ devRoot: tmp, name: 'flow', checks: [buildCheck()] }),
    ).rejects.toBeInstanceOf(SecuritySpecExistsError);
  });

  test('overwrite=true replaces the file', async () => {
    await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      checks: [buildCheck({ intent: 'first' })],
    });
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      checks: [buildCheck({ intent: 'second' })],
      overwrite: true,
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('second');
    expect(src).not.toContain("'first'");
  });

  test('emits Original prompt: + Outcome: from description + summary', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      description: 'probe /orders for IDOR',
      summary: 'Found one IDOR — /orders/:id returns other users without check.',
      checks: [buildCheck()],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain(' * Original prompt: probe /orders for IDOR');
    expect(src).toContain(' * Outcome: Found one IDOR');
  });

  test('emits Checks: block summarising each check', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      checks: [
        buildCheck({ id: 1, intent: 'first probe', matched: true, observed: { ...buildCheck().observed, status: 403 } }),
        buildCheck({ id: 2, intent: 'second probe' }),
      ],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('1. first probe');
    expect(src).toContain('2. second probe');
    expect(src).toContain('— pass');
    expect(src).toContain('**VULNERABILITY**');
  });

  test('emits Findings: only when there are unmatched (vulnerable) checks', async () => {
    const safeOnly = await writeSecuritySpec({
      devRoot: tmp,
      name: 'safe',
      checks: [
        buildCheck({ matched: true, observed: { ...buildCheck().observed, status: 403 } }),
      ],
    });
    expect(readFileSync(safeOnly.path, 'utf-8')).not.toContain(' * Findings:');

    const vulnerable = await writeSecuritySpec({
      devRoot: tmp,
      name: 'leak',
      checks: [buildCheck()], // matched: false
    });
    expect(readFileSync(vulnerable.path, 'utf-8')).toContain(' * Findings:');
  });

  test('always emits the auth-setup TODO header', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      checks: [buildCheck()],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('⚠ Authentication');
    expect(src).toContain('storageState');
    expect(src).toContain('FAQ');
  });

  test('per-check test() emits the correct Playwright method', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'methods',
      checks: [
        buildCheck({ id: 1, intent: 'get', observed: { ...buildCheck().observed, method: 'GET' } }),
        buildCheck({ id: 2, intent: 'post', observed: { ...buildCheck().observed, method: 'POST' } }),
        buildCheck({ id: 3, intent: 'patch', observed: { ...buildCheck().observed, method: 'PATCH' } }),
        buildCheck({ id: 4, intent: 'option', observed: { ...buildCheck().observed, method: 'OPTIONS' } }),
      ],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('await request.get(');
    expect(src).toContain('await request.post(');
    expect(src).toContain('await request.patch(');
    // OPTIONS isn't a first-class Playwright method, falls back to fetch.
    expect(src).toContain('await request.fetch(');
  });

  test('asserts the expected status', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      checks: [buildCheck({ expectStatus: 403 })],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('expect(response.status()).toBe(403);');
  });

  test('emits PII-leak guard for 4xx expectations when body excerpt is present', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'leak-guard',
      checks: [buildCheck({ expectStatus: 403 })],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('Coarse PII-leak guard');
    expect(src).toContain('toBeLessThan(500)');
  });

  test('skips PII-leak guard for 5xx + 2xx expectations', async () => {
    const r2 = await writeSecuritySpec({
      devRoot: tmp,
      name: 'two',
      checks: [buildCheck({ expectStatus: 200 })],
    });
    expect(readFileSync(r2.path, 'utf-8')).not.toContain('Coarse PII-leak guard');

    const r5 = await writeSecuritySpec({
      devRoot: tmp,
      name: 'five',
      checks: [buildCheck({ expectStatus: 500 })],
    });
    expect(readFileSync(r5.path, 'utf-8')).not.toContain('Coarse PII-leak guard');
  });

  test('skips PII-leak guard when body excerpt is null', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'no-body',
      checks: [
        buildCheck({
          expectStatus: 403,
          observed: { ...buildCheck().observed, bodyExcerpt: null },
        }),
      ],
    });
    expect(readFileSync(result.path, 'utf-8')).not.toContain('Coarse PII-leak guard');
  });

  test('escapes single quotes in test titles + intents', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: "alice's tests",
      checks: [buildCheck({ intent: "IDOR: alice's order leaked" })],
    });
    const src = readFileSync(result.path, 'utf-8');
    // The describe + test() string literals must be syntactically valid.
    expect(src).toContain("test.describe('security: alice\\'s tests'");
    expect(src).toContain("alice\\'s order leaked");
  });

  test('escapes */ in JSDoc comments to avoid early termination', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      description: 'this contains a */ closer somehow',
      checks: [buildCheck()],
    });
    const src = readFileSync(result.path, 'utf-8');
    // The dangerous sequence must NOT appear unescaped inside the
    // JSDoc block; the test() body below can have it freely.
    const headerEnd = src.indexOf(' */');
    const header = src.slice(0, headerEnd);
    expect(header).not.toMatch(/\*\/(?!\*)/); // no naked */ inside header
  });

  test('truncates very long prompts in the header', async () => {
    const longPrompt = 'a'.repeat(300);
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'flow',
      description: longPrompt,
      checks: [buildCheck()],
    });
    const src = readFileSync(result.path, 'utf-8');
    const m = src.match(/Original prompt: (a+)/);
    expect(m).not.toBeNull();
    // Truncated at 240 chars, matches the writeSpec behaviour.
    expect(m![1].length).toBeLessThanOrEqual(240);
  });

  test('suppresses never-submit noise checks (e.g. self-XSS) from the tests', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'mixed',
      checks: [
        buildCheck({ id: 1, intent: 'IDOR: read another user order' }),
        buildCheck({ id: 2, intent: 'Self-XSS in the profile name field' }),
      ],
    });
    const src = readFileSync(result.path, 'utf-8');
    // the real finding becomes a test; the self-XSS noise does not
    expect(src).toMatch(/test\('01 — IDOR: read another user order'/);
    expect(src).not.toMatch(/test\('0\d — Self-XSS/);
    // surfaced as suppressed, not silently dropped
    expect(src).toContain('Suppressed 1 noise check(s)');
    expect(src).toContain('Self-XSS in the profile name field');
  });

  test('reproduces a POST body (sanitized) when the check carries a request', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'mass-assign',
      checks: [
        buildCheck({
          intent: 'mass assignment: set role=admin',
          expectStatus: 200,
          observed: { ...buildCheck().observed, method: 'PATCH', url: 'http://localhost/api/me' },
          request: {
            method: 'PATCH',
            url: 'http://localhost/api/me',
            headers: { cookie: 'sid=secret', 'content-type': 'application/json' },
            bodyText: '{"name":"a","role":"admin","password":"hunter2"}',
          },
        }),
      ],
    });
    const src = readFileSync(result.path, 'utf-8');
    // body is carried so the replay isn't empty…
    expect(src).toContain('await request.patch("http://localhost/api/me"');
    expect(src).toContain('data:');
    expect(src).toMatch(/role.{0,8}admin/); // the non-secret payload survives (JSON-escaped in source)
    expect(src).toContain("'content-type': \"application/json\"");
    // …but credentials/secrets are stripped, never baked into the file
    expect(src).not.toContain('sid=secret');
    expect(src).not.toContain('hunter2');
    expect(src).toContain('<redacted>');
    expect(src).toContain('Redacted from the captured request');
  });

  test('omits request options for a GET check with no body (back-compat)', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'get-idor',
      checks: [buildCheck({ observed: { ...buildCheck().observed, method: 'GET' } })],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toMatch(/await request\.get\("[^"]+"\);/);
    expect(src).not.toContain('data:');
  });

  test('emits a multi-role browser.newContext test for a cross-identity check', async () => {
    const result = await writeSecuritySpec({
      devRoot: tmp,
      name: 'idor-cross',
      checks: [
        buildCheck({
          intent: 'IDOR: B reads A order',
          expectStatus: 403,
          observed: { ...buildCheck().observed, method: 'GET', url: 'http://localhost/api/orders/1', status: 200 },
          request: { method: 'GET', url: 'http://localhost/api/orders/1', headers: { cookie: 'sid=a' }, bodyText: null },
          crossIdentity: { identityB: 'state/userB.json' },
        }),
      ],
    });
    const src = readFileSync(result.path, 'utf-8');
    expect(src).toContain('async ({ browser })');
    expect(src).toContain('browser.newContext({ storageState: "state/userB.json" })');
    expect(src).toContain('ctxB.request.get(');
    expect(src).toContain('expect(response.status()).toBe(403)');
    expect(src).toContain('await ctxB.close();');
    // A's cookie is never baked in — B's session comes from storageState
    expect(src).not.toContain('sid=a');
  });
});
