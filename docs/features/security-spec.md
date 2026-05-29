# Save as Security spec

> Added in v0.12. Requires [`@hover-dev/security`](https://www.npmjs.com/package/@hover-dev/security).

Close the security-testing loop opened in v0.7: turn the agent's authz / IDOR / parameter-tampering probes into deterministic Playwright regression specs that run in CI without MITM, without the agent.

## What it does

While Hover is in **Security mode**, the agent uses the `replay_flow` MCP tool to re-send captured requests with mutations (changed URL, missing auth header, altered body field). In v0.12, `replay_flow` gained two parameters:

| Parameter | Purpose |
|---|---|
| `intent` | One-line human description, e.g. `"IDOR: access another user's order"` |
| `expectStatus` | The HTTP status that proves the security control works, e.g. `403` |

When the agent passes BOTH parameters, the replay is **recorded as a security check** in the control plane. Recorded checks accumulate across the session. When you're done probing, click **Save as → Security spec** on the Result card. Hover writes:

```ts
// __vibe_tests__/orders-idor.security.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Hover security regression — generated 2026-05-29.
 * Original prompt: probe /orders for IDOR vulnerabilities
 * Outcome: Found one IDOR — /orders/:id returns other users without check.
 *
 * Checks:
 *   1. IDOR: access another user's order
 *      GET http://localhost:5174/api/orders/999
 *      → expected 403, observed 200 — **VULNERABILITY**
 *
 * Findings:
 *   • **Vulnerability** — IDOR: access another user's order: expected 403, got 200.
 *
 * ⚠ Authentication: the agent recorded these requests with cookies from
 *   a logged-in debug-Chrome session. CI does not share those cookies.
 *   Wire your project's auth state into Playwright's `request` fixture
 *   before running this spec in CI — typically a `storageState` setup
 *   under `playwright.config.ts`. See the FAQ entry "Security spec auth
 *   setup" for the recipe.
 */
test.describe('security: orders-idor', () => {
  test('01 — IDOR: access another user\'s order', async ({ request }) => {
    // Recorded as a vulnerability: observed 200, expected 403.
    // After fix, this test passes (server now returns 403).
    const response = await request.get('http://localhost:5174/api/orders/999');
    expect(response.status()).toBe(403);
    // Coarse PII-leak guard: a real 4xx should be short.
    const body = await response.text();
    expect(body.length).toBeLessThan(500);
  });
});
```

## When to use it

- The agent flags a suspected vulnerability — you want a regression check so the fix can't accidentally regress.
- You're hardening an existing endpoint — record N expected-deny checks (different attacker shapes), save them as a single security spec, run the suite after each change.
- You're verifying a control during code review — point Hover at the staging branch, record checks, attach the resulting spec to the PR.

## When NOT to use it

- For end-to-end UI tests of security flows (login → MFA → logout). Use the normal **Save as Spec** for that — UI semantics, not HTTP-level assertions.
- For untriaged "let me explore" sessions. Until you know what you're checking and what the expected status is, just `replay_flow` without `intent` / `expectStatus`. The check log accumulates only deliberate assertions.
- On systems you don't own. Hover's security plugin runs against `<your-dev-server>`; the [SECURITY.md](https://github.com/Hyperyond/Hover/blob/main/SECURITY.md) policy applies.

## Caveats

- **Auth state.** The agent recorded the requests with cookies from your logged-in debug Chrome. CI is a fresh process — you need Playwright's `storageState` mechanic to round-trip auth. The spec emits a TODO header pointing at the FAQ. See [FAQ: Security spec auth setup](/faq#security-spec-auth-setup-how-do-i-run-a-security-spec-in-ci-when-the-auth-cookies-live-in-my-debug-chrome).
- **PII-leak guard is coarse.** For 4xx expectations, the spec checks `body.length < 500` as a proxy for "this is a real deny page, not a leak masquerading as 403". Tighten by hand for high-value endpoints.
- **Both parameters required to record.** Missing `intent` or `expectStatus` → the replay still works, but isn't recorded. The MCP server's response includes a `_(Not recorded as a check — both intent and expectStatus are required together.)_` hint when one is supplied and the other isn't.
- **Auth header replay.** Cookies / auth headers from the source flow are replayed verbatim by default. To test "what if the attacker drops the auth header", pass `headers: { authorization: null }` along with `intent` and `expectStatus`.

## Internals (for plugin authors)

This release added two reusable plugin APIs:

- **`HoverPluginManifest.saveHandlers`** (server) — `Array<{ type, label, description?, activeInModes?, handle(ctx) }>`. The service routes incoming `save:<type>` WS messages to the matching plugin handler. Each plugin owns its own write semantics (no forcing into core's `SkillStep[]` shape).
- **`WidgetPluginSpec.saveEntries`** (widget) — `Array<{ type, label, sub?, fields?, confirmLabel?, successMsgTemplate? }>`. The widget's Save-as dropdown queries the active plugin's entries on open via `host.getActiveSaveEntries()` and appends them to the menu.

Any plugin can register its own save type. The security plugin uses this for `save:security:spec`; a hypothetical perf-probe plugin could register `save:perf:report` the same way.

Reference: [`packages/security/src/writeSecuritySpec.ts`](https://github.com/Hyperyond/Hover/blob/main/packages/security/src/writeSecuritySpec.ts) — the writer the handler delegates to. 17 unit tests cover the spec emission paths.
