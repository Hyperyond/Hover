# Security testing

> Status: **0.7 preview**. The plugin works end-to-end; UI polish + recording semantics for security sessions are tracked for the next iteration.

`@hover-dev/security` is Hover's first optional plugin. Switch the widget into **Security testing** mode and Hover starts capturing every HTTPS call your dev page makes — then lets the AI agent re-issue any of those calls with mutations to probe for IDOR / authentication bypass / parameter tampering. Findings save as plain Playwright specs that run in CI without the proxy.

## Why a separate mode

Hover's default mode is for *building features*. Security testing is for *attacking what you just built* — the agent's prompt is different ("look for authz bypass", not "test the happy path"), the Chrome it drives runs in a separate profile, and the **mode bar tints orange** so you can never forget you're in altered state.

## Install

```bash
pnpm add -D @hover-dev/security
```

```ts
// vite.config.ts (Astro / Nuxt / Next / Webpack mirror the same pattern)
import { hover } from 'vite-plugin-hover';
import securityMode from '@hover-dev/security';

export default defineConfig({
  plugins: [hover({}, securityMode())],
});
```

Zero external dependencies — no `mitmproxy`, no Python, no system CA install. The plugin uses [mockttp](https://github.com/httptoolkit/mockttp) (the engine behind HTTP Toolkit) for HTTPS MITM, generates a one-off CA the first time it starts, and pins it to the secured Chrome via `--ignore-certificate-errors-spki-list` — your OS trust store stays untouched.

::: warning Don't commit the CA
The CA private key persists under `<your-project>/.hover/ca/ca.key`. The shipped `.gitignore` includes `.hover/` already; if you removed it, add it back.
:::

## Usage

1. Click the ✨ launcher, then the **mode bar** above the panel header.
2. Pick **Security testing**.
3. The panel border + launcher ring turn orange to signal altered state. A separate debug Chrome opens on port 9333 (the default mode's Chrome on 9222 stays untouched).
4. Drive the page as a normal user would — log in, navigate, submit forms. Every HTTPS request is captured.
5. Click the 🔁 **Network** icon next to the agent pill to see the captured flow list.
6. In the chat textarea, ask the agent something like:

   ```
   list_flows, then look for IDOR vulnerabilities in the order endpoints
   ```

   The agent uses `mcp__hover_dev_security_flows__list_flows` to enumerate the API surface, `get_flow` to inspect specific requests, and `replay_flow` to test mutations.

7. When findings show up in the Result + Findings cards, click **Save as Spec** to crystallize a Playwright regression test.

## What the agent looks for

The system prompt restricts the agent to **browser-reachable** vulnerability classes, in this priority order:

### 1. Authorisation / authentication (highest signal)

- **IDOR** — change a resource id in a captured URL and replay. A 200 OK is the vulnerability.
- **Authentication bypass** — drop or swap the auth header in a replay.
- **Parameter tampering** — mutate request body fields (`user_id`, `role`, `price`, `isAdmin`) and replay.
- **Mass assignment** — add fields the form didn't expose (`admin: true`, `email: "victim@…"`) and check if they take effect.

### 2. Frontend / browser-side issues

- **XSS** — inject `<script>`, `javascript:`, or `onerror=` into URL params, form inputs, and postMessage handlers.
- **Open redirects** — find URL params that control redirect targets.
- **DOM clobbering / prototype pollution** — only flagged when the agent can demonstrate concrete impact, not theoretical surface.
- **Missing security headers** — CSP, X-Frame-Options, HSTS, SameSite cookies.

### 3. Compliance / privacy (GDPR / CCPA signals)

- **PII in URL query strings** (email, name, phone in GET params).
- **Cookies without `Secure` / `HttpOnly` / `SameSite`** when carrying session data.
- **Third-party requests carrying user data before consent was granted**.

## Scope boundaries

The agent will refuse to attempt:

- **SQL injection, SSRF, command injection, deserialisation attacks** — these are server-side concerns this browser-driven framework can't usefully probe. The prompt explicitly forbids them.
- **Automated fuzzing loops** — security mode stays surgical: one hypothesis, one targeted replay, one observation.
- **Modifying CSP / cookie settings before testing** — the application is probed as deployed.
- **Real-user-data exfiltration** — this is a dev environment; the agent uses placeholder ids when demonstrating an issue.

If you need server-side fuzzing or SQL injection testing, run an actual server-side scanner (`sqlmap`, ZAP active scan, etc.) — Hover is not that tool.

## Tools available to the agent in security mode

| Tool | Purpose |
|---|---|
| `list_flows()` | Enumerate captured HTTP flows (no bodies — just method / url / status / mutation marker). |
| `get_flow(id)` | Full request + response headers + body for one flow. |
| `replay_flow(id, mutation?)` | Re-issue a captured flow with optional method / url / headers / body overrides. The new flow is added to the store with its own id. |
| `clear_flows()` | Drop captured flows between probe rounds. |
| `mcp__playwright__*` | Standard browser-driving tools — navigate, click, fill, screenshot, evaluate. |

Mutations to `replay_flow` use a small JSON shape:

```ts
{
  method?: string;                              // override HTTP method
  url?: string;                                 // override URL — typical IDOR test
  headers?: Record<string, string | null>;      // overrides; null deletes
  bodyText?: string;                            // replace UTF-8 body
}
```

The shape mirrors the agent-facing MCP schema, so what you see in the docs is what the agent receives in its tool catalogue.

## Reporting style

When the agent finishes, findings render in a colour-coded **Findings card** next to the Result card. The agent uses these markers in its `## Findings` block:

- **Bug** — concrete vulnerability with reproducible impact. Red.
- **Minor** — weak hardening, no immediate exploit (e.g. missing header). Amber.
- *(no marker)* — informational observation. Neutral.

## Crystallized output

Spec output looks like:

```ts
// __vibe_tests__/orders-idor-victim-can-view-their-own.spec.ts
import { test, expect } from '@playwright/test';

test('User A cannot read User B order', async ({ page, request }) => {
  // Log in as User A
  await page.goto('/login');
  await page.getByLabel('Email').fill('userA@example.com');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Attempt to read User B's order
  const res = await request.get('/api/orders/userB-1', {
    headers: { cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') },
  });

  expect(res.status()).toBe(403);
});
```

The MITM proxy is **not** part of this spec. The replay primitive lives in Playwright's own `request` fixture — CI runs this with vanilla `@playwright/test`, no Hover, no `@hover-dev/security`, no mockttp.

## Implementation primer

For contributors who want to extend the plugin or write a similar one:

- `packages/security/src/mitm/` — mockttp lifecycle (CA generation, FlowStore, proxy wrapper, replay primitives).
- `packages/security/src/control-plane.ts` — loopback HTTP API the MCP server talks to (Bearer-token auth on a process-random secret).
- `packages/security/src/mcp/server.ts` — the stdio MCP server using `@modelcontextprotocol/sdk`. Tool descriptions explicitly mention IDOR / authz-bypass / parameter-tampering use cases so the agent picks the right one.
- `packages/security/src/index.ts` — the plugin manifest itself.

See [Reference → Plugin API](/reference/plugin-api) for the manifest shape `@hover-dev/security` is built on.

## Limitations (honest)

- **Service workers** — Playwright's `page.route()` historically can't see SW-mediated requests. The MITM proxy bypasses this (it's at the network layer, not the renderer layer), so capture works fine. But if your saved spec relies on observing a SW-routed request, you'll need to express it as `page.request.fetch()` (which goes around the SW) rather than `page.route()`.
- **HTTP/3 / QUIC** — Chrome will quietly downgrade through the proxy. Not visible as h3 in the captured flow list.
- **Cross-origin iframes** — captured, but the widget's panel currently flattens the flow list; correlating which iframe a flow came from is future work.
- **Session recording for security sessions** — the **Record** button is hidden in security mode for now. Its current semantics (record clicks → spec) don't match security workflow. The right semantics ("record a security session = captured flows + agent replays → security regression spec") is a future iteration.
