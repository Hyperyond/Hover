import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HoverMcpController } from './controller.js';

/* Wrap the controller as an MCP server. Tool names + the GROUNDED target shape
 * mirror Hover's control MCP so an agent that knows one knows the other. Every
 * handler returns text (✓/✗) and never throws — a failed locate/action becomes
 * a ✗ message the calling agent can react to, not an MCP transport error. */

const md = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const errLine = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

const GROUND = {
  role: z.string().optional().describe("ARIA role from the snapshot, e.g. 'button', 'textbox', 'link'. Pair with `name`."),
  name: z.string().optional().describe('Accessible name from the snapshot, exactly as shown. Pair with `role`.'),
  testId: z.string().optional().describe('A data-testid, if the element has one and no clean role+name.'),
  text: z.string().optional().describe('Real visible text on the element — last resort.'),
  within: z
    .object({ role: z.string(), name: z.string() })
    .optional()
    .describe('Scope the search to a container first (role+name) when a label repeats across groups.'),
};

/** One asserted API call for crystallize_api_spec — mirrors core's ApiCheck. */
const API_CHECK = z.object({
  title: z.string().describe('Short test name, e.g. "GET /api/cart returns the cart".'),
  method: z.string(),
  url: z.string().describe('Full URL or same-origin path (same-origin is relativized in the spec).'),
  requestBody: z.any().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  expectStatus: z.number().optional().describe('Expected status — verified with replay_request.'),
  expectBodyKeys: z.array(z.string()).optional().describe('Top-level response keys to assert present.'),
  note: z.string().optional().describe('Emitted as a leading comment, e.g. "authz: no session → 401".'),
});

export function createHoverMcpServer(c: HoverMcpController): McpServer {
  const server = new McpServer({ name: 'hover', version: '0.1.0' });
  const guard = (fn: () => Promise<string>) => fn().then(md, (e) => md(`✗ ${errLine(e)}`));

  server.registerTool(
    'browser_navigate',
    { description: 'Open a URL in the app under test (the debug Chrome).', inputSchema: { url: z.string() } },
    ({ url }) => guard(() => c.navigate(url)),
  );

  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Read the current page as an ARIA snapshot (role + accessible-name tree). Call this BEFORE actuating to get the exact role+name to pass to the *_control tools.',
      inputSchema: {},
    },
    () => guard(() => c.snapshot()),
  );

  server.registerTool(
    'click_control',
    {
      description:
        'Click a control by a GROUNDED target read off the snapshot (role+name preferred → testId → text). Grounded so the saved spec replays exactly what you did.',
      inputSchema: GROUND,
    },
    (g) => guard(() => c.click(g)),
  );

  server.registerTool(
    'fill_control',
    { description: 'Type a value into a textbox/field by a grounded target.', inputSchema: { ...GROUND, value: z.string() } },
    ({ value, ...g }) => guard(() => c.fill(g, value)),
  );

  server.registerTool(
    'select_control',
    { description: 'Choose an option in a <select> by a grounded target.', inputSchema: { ...GROUND, value: z.string() } },
    ({ value, ...g }) => guard(() => c.select(g, value)),
  );

  server.registerTool(
    'check_control',
    {
      description: 'Check or uncheck a checkbox/radio by a grounded target (handles sr-only / hidden inputs).',
      inputSchema: { ...GROUND, checked: z.boolean().optional().describe('true (default) = check; false = uncheck.') },
    },
    ({ checked, ...g }) => guard(() => c.check(g, checked !== false)),
  );

  server.registerTool(
    'assert_visible',
    {
      description: 'Assert a control/text is visible now — captures an expect(...).toBeVisible() into the saved spec.',
      inputSchema: GROUND,
    },
    (g) => guard(() => c.assertVisible(g)),
  );

  server.registerTool(
    'recall_business_knowledge',
    {
      description:
        'Recall what earlier Hover runs learned about this app (business rules, expected behaviors, access policies). Call this at the START so you do not re-ask settled questions. Treat what it returns as ground truth.',
      inputSchema: {},
    },
    () => guard(() => c.recall()),
  );

  server.registerTool(
    'record_fact',
    {
      description:
        "Remember a durable BUSINESS RULE about this app so neither you nor a future run re-asks it — e.g. an expected behavior, a validation rule, an access policy, or the answer to a 'bug or by-design?' the user just confirmed. State it as a clean self-contained rule. RULES ONLY — never store secrets, passwords, tokens, or personal data.",
      inputSchema: {
        title: z.string().describe('Short title for the rule (becomes its memory filename + index entry).'),
        rule: z.string().describe('The rule itself, stated clearly and self-contained (no secrets/PII).'),
        type: z
          .enum(['business-rule', 'expected-behavior', 'validation', 'access-policy'])
          .optional()
          .describe('What kind of knowledge this is. Defaults to business-rule.'),
      },
    },
    ({ title, rule, type }) => guard(() => c.recordFact(title, rule, type ?? 'business-rule')),
  );

  server.registerTool(
    'crystallize_spec',
    {
      description:
        'Save the flow you JUST performed (the grounded click/fill/select/check/assert actions since the last crystallize) as a plain Playwright .spec.ts in __vibe_tests__/. Call it the moment you finish a coherent end-to-end flow. Name it in English, imperative (e.g. "Log in").',
      inputSchema: {
        name: z.string().describe('Short imperative flow name in English — becomes the spec filename + test name.'),
        description: z.string().optional().describe('One line on what this flow verifies.'),
      },
    },
    ({ name, description }) => guard(() => c.crystallize(name, description)),
  );

  // ── API layer ──────────────────────────────────────────────────────────────
  // While you drive the UI, Hover passively buffers the app's xhr/fetch traffic
  // off the same CDP connection (no MITM). Read it, verify a check, crystallize.

  server.registerTool(
    'capture_requests',
    {
      description:
        "Return the app's xhr/fetch API calls observed while you drove the UI (method, url, status, content-type, request body, response shape). Call it after exercising a flow to see which endpoints it hit. Optionally filter.",
      inputSchema: {
        urlContains: z.string().optional().describe('Only calls whose URL contains this substring.'),
        method: z.string().optional().describe('Only calls with this HTTP method.'),
      },
    },
    ({ urlContains, method }) => guard(() => Promise.resolve(c.captureRequests({ urlContains, method }))),
  );

  server.registerTool(
    'replay_request',
    {
      description:
        'Send a (possibly mutated) request and return the response, to VERIFY an API check before crystallizing it (no confabulated status codes). For an authz check, set authenticated:false (fresh context, no session) and expect 401/403; or drop/alter headers / swap an id for IDOR.',
      inputSchema: {
        method: z.string().describe('HTTP method, e.g. GET / POST.'),
        url: z.string().describe('Full URL or same-origin path.'),
        headers: z.record(z.string(), z.string()).optional().describe('Headers to send (omit/blank the auth header for a "requires auth" check).'),
        body: z.any().optional().describe('Request body for POST/PUT/PATCH.'),
        authenticated: z
          .boolean()
          .optional()
          .describe('true (default) = replay with the browser session; false = fresh context with NO session (for "requires auth" checks).'),
      },
    },
    ({ method, url, headers, body, authenticated }) =>
      guard(() => c.replayRequest({ method, url, headers, body, authenticated })),
  );

  server.registerTool(
    'crystallize_api_spec',
    {
      description:
        'Save selected API checks as a plain Playwright `*.api-test.spec.ts` (uses the `request` fixture). Use it ALONGSIDE crystallize_spec when a flow exercised a worthwhile API surface — a real contract, a data mutation, or an authz boundary. Be SELECTIVE: lock checks that matter, not every captured call. Verify each with replay_request first.',
      inputSchema: {
        name: z.string().describe('Short imperative English name — becomes the <name>.api-test.spec.ts filename.'),
        description: z.string().optional().describe('One line on what this API spec verifies.'),
        checks: z.array(API_CHECK).describe('The API checks to lock — each a request + its expected status / shape / authz outcome.'),
      },
    },
    ({ name, description, checks }) => guard(() => c.crystallizeApiSpec(name, description, checks)),
  );

  // The workflow ships WITH the server as an MCP prompt — Claude Code surfaces
  // it as `/mcp__hover__test_app`, so adding the server brings both the tools
  // AND the command. No project scaffolding needed.
  server.registerPrompt(
    'test_app',
    {
      title: 'Hover — map & crystallize a test suite',
      description: 'Map this app\'s business lines and crystallize a Playwright suite (incremental, scales to large apps).',
      argsSchema: { scope: z.string().optional().describe('An area/flow to focus on. Omit to cover the whole app.') },
    },
    ({ scope }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: workflowPrompt(scope) } }],
    }),
  );

  return server;
}

/** The phased, scale-aware workflow, delivered as the prompt body. Mirrors the
 *  hover-mcp tool surface; the agent's own file tools do the code-reading. */
function workflowPrompt(scope?: string): string {
  const target = scope?.trim() ? scope.trim() : 'the whole app';
  return `Build (or extend) a Playwright test suite for this web app using the **Hover MCP tools**.
Drive the browser ONLY through these tools — they actuate via grounded selectors
(role+name → testId → text), so every spec you save replays EXACTLY what you did
(record==replay). Never write spec files yourself; only \`crystallize_spec\` does.

Tools: \`recall_business_knowledge\` · \`browser_navigate\` · \`browser_snapshot\` (ARIA
tree — read before acting) · \`click_control\` / \`fill_control\` / \`select_control\` /
\`check_control\` (grounded target from the snapshot) · \`assert_visible\` ·
\`record_fact\` · \`crystallize_spec(name, description?)\`. API layer:
\`capture_requests\` · \`replay_request\` · \`crystallize_api_spec\`.

Target: the app at HOVER_TARGET (set in the server's env). Scope: ${target}.

## Ground rules (they protect record==replay AND the user's real app)
- **Grounded targets only.** Pass role+name EXACTLY as they appear in the LATEST \`browser_snapshot\`. If a locate fails, re-snapshot and read the real target — never guess, invent, or reuse a stale name.
- **It's the user's REAL app.** Avoid irreversible / destructive actions — real payments, deleting data you didn't create, sending real emails or SMS — unless the user confirms this is a safe test environment. When unsure, ASK first.
- **Assert stable outcomes.** Assert on semantic, durable signals (a success message, a heading, a new row's label) — NEVER volatile instance data (timestamps, generated ids, "today", a one-off order number), which makes the saved spec flaky on replay.
- **Log in first.** If the app needs auth, do that before anything else — ask for credentials if you don't have them — then crystallize it as its own "Log in" spec and stay logged in for the rest of the run.

Work in PHASES — this is what lets it scale from a tiny app to a large one.

## Phase 1 — Map the business lines (read the CODE, don't click around)
- FIRST call \`recall_business_knowledge\` — rules earlier runs learned (and read \`.hover/hover-map.md\` if it exists, the running map; CONTINUE it, don't start over). Treat both as ground truth; don't re-ask what they already answer.
- Use YOUR OWN file tools (read / grep / glob) to find the app's ROUTES + navigation: the router config, route/page files, the nav components. Enumerate the user-facing BUSINESS LINES (a coherent task a user performs), each with its entry route, grouped by area. Reading code is cheaper + more complete than clicking around, and finds areas behind auth / nav you'd otherwise miss.
- Write/update \`.hover/hover-map.md\` as a checklist (4-space indent = a code block):

        # Business map — <app>
        ## Auth
        - [ ] Log in — /login
        - [x] Checkout — /checkout — checkout.spec.ts

- Don't test yet. For a large app, this map IS the plan.

## Phase 2 — Pick the scope
- If a scope was given, cover that. Otherwise show the uncovered lines and ask which to cover now (offer "all uncovered"). For a small app, just cover them all.

## Phase 3 — Cover each chosen line, ONE AT A TIME
For each line: \`browser_navigate\` to its route → \`browser_snapshot\` → EXERCISE the real flow (click / fill / select / check — you are a tester, never just describe the page) → \`assert_visible\` on the OUTCOME (a success message, the new row, the next screen) → \`crystallize_spec("<short imperative English name>")\`. Crystallize the MOMENT each flow is done, before the next — the buffer is per-flow. The tools share ONE browser, so cover lines SEQUENTIALLY.

## Phase 3.5 — Lock the API layer too (SELECTIVELY)
As you drive each flow, Hover passively captures the app's xhr/fetch traffic. After a flow, call \`capture_requests\` to see what it hit. For a line that exercised a **worthwhile API surface — a data mutation (POST/PUT/DELETE), a clear contract, or an authz boundary** — also lock an API spec:
- Decide the checks. Contract: the call returns its status + key fields. Authz: the same call WITHOUT the session must be refused — call \`replay_request\` with \`authenticated:false\` and confirm it's 401/403 before asserting it.
- VERIFY each check with \`replay_request\` first (so you never assert a confabulated status), then \`crystallize_api_spec(name, checks)\` → a \`*.api-test.spec.ts\`.
- Be SELECTIVE — skip pure-display reads, analytics, third-party pings. Most UI flows need 0–1 API specs. A static/read-only flow needs none. This is judgment, not a per-flow quota.

## Phase 4 — Update coverage
- Mark each covered line \`[x]\` in \`.hover/hover-map.md\` with its spec filename. Report covered vs still-open. A LARGE app doesn't have to finish in one go — covering a batch + updating the map is a complete, resumable unit; re-invoke to continue the uncovered lines.

## Understand the business — ASK, then REMEMBER
When you genuinely can't resolve something on your own — is this a bug or by-design? which flows matter? what does this domain term mean? — ASK the user (don't guess, don't stop). When they confirm a durable business RULE, call \`record_fact\` to persist it (RULES ONLY — never credentials/secrets/PII). Also ASK when blocked on something only they can provide (login credentials, a file). Stay on the app under test — never navigate to external origins.`;
}
