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
        'Recall what earlier Hover runs learned about this app (business rules, expected behaviors, access policies). Call this at the START so you do not re-ask settled questions. Treat what it returns as ground truth. For an app with a lot of remembered rules this returns an INDEX (one line per rule); when a rule is relevant to what you are testing, read its full text with recall_fact.',
      inputSchema: {},
    },
    () => guard(() => c.recall()),
  );

  server.registerTool(
    'recall_fact',
    {
      description:
        "Read ONE remembered business rule's full text by name (the name shown in the recall_business_knowledge index). Use it when recall returned only the index and you need a specific rule's detail before deciding how to test.",
      inputSchema: {
        name: z.string().describe('The rule name from the recall index (a slug like "guests-cannot-checkout").'),
      },
    },
    ({ name }) => guard(() => c.recallFact(name)),
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

  // ── Self-heal ────────────────────────────────────────────────────────────
  server.registerTool(
    'replay_spec',
    {
      description:
        "Detect drift in a saved spec: replay its RECORDED grounded steps against the LIVE app and report the first step that no longer locates (its index + what it was looking for). No `playwright test` needed. Use this to find what to heal, then re-ground that step and re-crystallize.",
      inputSchema: {
        slug: z.string().describe('The spec slug = its filename without .spec.ts (e.g. "login" for login.spec.ts).'),
      },
    },
    ({ slug }) => guard(() => c.replaySpec(slug)),
  );

  // ── Page Object extraction (detect → ask → extract) ──────────────────────
  server.registerTool(
    'detect_shared_flows',
    {
      description:
        'After crystallizing the suite, report NON-login flows repeated across specs (login is already handled by the auth setup). Use it to decide whether to OFFER lifting a shared flow into a Page Object — then ASK the user before extracting.',
      inputSchema: {},
    },
    () => guard(() => c.detectSharedFlows()),
  );

  server.registerTool(
    'extract_page_objects',
    {
      description:
        'Lift the shared flows into __vibe_tests__/pages/* + fixtures.ts and fold the specs that use them (they call `await xPage.x()` from ./fixtures). Deterministic. Call ONLY after the user approves the offer from detect_shared_flows.',
      inputSchema: {},
    },
    () => guard(() => c.extractPageObjects()),
  );

  // ── Wiki lint (LLM-Wiki P1) ──────────────────────────────────────────────
  server.registerTool(
    'lint_map',
    {
      description:
        "Health-check the app's test wiki (.hover/): cross-check the business map against the real spec files and the run ledger. Reports deleted specs (a line points at a missing *.spec.ts), regressed coverage (a covered line's spec last ran fail/flaky → heal it), and orphan specs (a spec no line maps). Deterministic; no LLM. Run it to find drift, then fix each finding (heal / re-map / drop the stale ref).",
      inputSchema: {},
    },
    () => guard(() => c.lintWiki()),
  );

  // ── Optimize (F7) ────────────────────────────────────────────────────────
  // The IMPROVEMENT is the agent's (the /mcp__hover__optimize prompt gives it the
  // brief); this tool is Hover's guardrail + write path — it validates the agent's
  // result and files it as a review candidate, never touching the spec.
  server.registerTool(
    'save_optimized_spec',
    {
      description:
        "File an improved spec (produced from the /optimize brief) as a REVIEW CANDIDATE. Hover validates it (semantic selectors, no waitForTimeout/XPath, parses), soft-batches trailing assertions, and writes .hover/cache/optimized/<slug>.spec.ts.draft — it does NOT overwrite your spec. On a ✗ (rejected check), fix it and call again. This is the only way to file an optimization; don't write the .draft yourself.",
      inputSchema: {
        slug: z.string().describe('The spec slug being optimized (its filename without .spec.ts).'),
        code: z.string().describe('The COMPLETE improved .ts file contents.'),
      },
    },
    ({ slug, code }) => guard(() => c.saveOptimized(slug, code)),
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

  // Optimize workflow — surfaced as `/mcp__hover__optimize`. Hover builds the
  // brief (spec + observed session + Page Objects); the agent does the thinking.
  server.registerPrompt(
    'optimize',
    {
      title: 'Hover — enrich a spec with observed assertions',
      description: 'Improve a crystallized spec: add assertions for what the session observed, de-literalize volatile values, reuse Page Objects. Files a review candidate; never overwrites the spec.',
      argsSchema: { spec: z.string().describe('The spec slug to optimize (e.g. "checkout" for checkout.spec.ts).') },
    },
    async ({ spec }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: await c.optimizeBrief(spec) } }],
    }),
  );

  // Wiki-lint workflow — surfaced as `/mcp__hover__lint`. The tool does the
  // mechanical checks; the prompt drives the LLM-judged half on top.
  server.registerPrompt(
    'lint',
    {
      title: 'Hover — lint the test wiki',
      description: "Health-check .hover/: deterministic drift (dead spec refs, regressed coverage, unmapped specs) plus LLM-judged checks (contradictory rules, code routes missing from the map), then offer fixes.",
      argsSchema: {},
    },
    () => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: lintPrompt() } }],
    }),
  );

  // Self-heal workflow — surfaced as `/mcp__hover__heal`.
  server.registerPrompt(
    'heal',
    {
      title: 'Hover — heal a drifted spec',
      description: "Replay a saved spec against the live app; where the UI drifted, re-ground the broken step and re-crystallize. Pass a spec to heal one, or omit to check all.",
      argsSchema: { spec: z.string().optional().describe('A spec slug to heal (e.g. "login"). Omit to check every spec.') },
    },
    ({ spec }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: healPrompt(spec) } }],
    }),
  );

  return server;
}

/** Wiki-lint workflow body. `lint_map` does the mechanical checks; the agent
 *  layers the LLM-judged checks (contradictions, unmapped code routes) and fixes. */
function lintPrompt(): string {
  return `Lint this app's **test wiki** (\`.hover/\`) using the Hover MCP tools, then fix what you find. The wiki = the business map (\`.hover/hover-map.md\`), the business-rule memory (\`.hover/memory/*.md\`), and the crystallized specs it points at.

1. **Deterministic drift** — call \`lint_map\`. It cross-checks the map against the real spec files and the run ledger and reports:
   - **deleted-spec** — a line points at a \`*.spec.ts\` that's gone. Re-crystallize the flow, or drop the stale reference from the map.
   - **regressed-coverage** — a covered line whose spec last ran fail/flaky. Heal it with \`/mcp__hover__heal <slug>\` (or say it's a real app bug to fix).
   - **orphan-spec** — a spec no line maps. Add its business line to the map (\`[x]\` with the spec).
2. **Contradictory rules (LLM-judged)** — read \`.hover/memory/*.md\`. If two facts conflict (e.g. one says guests can check out, another says they can't), surface the pair and ASK the user which holds; correct the wrong one with \`record_fact\` (or delete it).
3. **Unmapped code routes (LLM-judged)** — with your own file tools, grep the app's router for user-facing routes. Any real route absent from \`.hover/hover-map.md\` is a coverage gap — add it as an uncovered \`[ ]\` line under the right area so the map stays honest.
4. **Report + fix** — summarize the findings, apply the safe fixes (re-map, add gaps, correct rules), and for anything destructive (dropping a spec, deleting a rule) ASK first. Update \`.hover/hover-map.md\` as you go.

Stay on the app under test. Don't invent business lines that don't exist in the code.`;
}

/** Self-heal workflow body. The agent uses `replay_spec` to find the drift,
 *  re-grounds the broken step by its recorded intent, and re-crystallizes. */
function healPrompt(spec?: string): string {
  const scope = spec?.trim()
    ? `the spec \`${spec.trim()}\``
    : 'every spec under `__vibe_tests__/` (list them first, then heal each that drifted)';
  return `Heal ${scope} for this app using the **Hover MCP tools** — repair specs whose UI drifted, without rewriting them by hand.

A spec "drifted" when the app changed so a recorded step no longer locates its control (a renamed button, a moved field). Healing = re-grounding ONLY the broken step against the current UI, keeping everything else, so record==replay still holds.

Work ONE spec at a time:

1. **Detect** — \`replay_spec("<slug>")\`. It replays the spec's recorded grounded steps against the live app and reports the first step that fails to locate: its index, the tool, and what it was \`lookingFor\` (role+name/text). If it replays clean, that spec is fine — move on.
2. **Re-ground the broken step** — \`browser_navigate\` to the spec's route, \`browser_snapshot\`, and find the control that NOW serves the intent in \`lookingFor\` (e.g. the submit button whose label changed "Sign in" → "Log in"). Re-drive from the break with the grounded \`*_control\` tools. Change ONLY what drifted — don't redesign the flow.
3. **Re-crystallize** — when the flow runs green again, \`crystallize_spec\` with the SAME name as the broken spec to overwrite it with the healed version.
4. **Report** — say which step drifted, what changed (old target → new target), and that it's re-crystallized. The user reviews the old-vs-new diff in the cockpit before keeping it.

Rules: heal by the recorded INTENT (re-locate the same control), never invent a new flow or new assertions. If a step is gone because the FEATURE was removed (not just renamed), don't guess — say so and ASK whether to drop that step or the whole spec. Stay on the app under test.`;
}

/** The phased, scale-aware workflow, delivered as the prompt body. Mirrors the
 *  hover-mcp tool surface; the agent's own file tools do the code-reading. */
function workflowPrompt(scope?: string): string {
  const target = scope?.trim() ? scope.trim() : 'the whole app';
  return `Build (or extend) a Playwright test suite for this web app using the **Hover MCP tools**.
Drive the browser ONLY through these tools — they actuate via grounded selectors
(role+name → testId → text), so every spec you save replays EXACTLY what you did
(record==replay). Never write spec files yourself; only \`crystallize_spec\` does.

Tools: \`recall_business_knowledge\` / \`recall_fact\` · \`browser_navigate\` ·
\`browser_snapshot\` (ARIA tree — read before acting) · \`click_control\` /
\`fill_control\` / \`select_control\` / \`check_control\` (grounded target from the
snapshot) · \`assert_visible\` · \`record_fact\` · \`crystallize_spec(name, description?)\`.
API layer: \`capture_requests\` · \`replay_request\` · \`crystallize_api_spec\`. Suite:
\`detect_shared_flows\` · \`extract_page_objects\` · \`replay_spec\` · \`lint_map\`.

Target: the app at HOVER_TARGET (set in the server's env). Scope: ${target}.

## First: are you bootstrapping or extending? (load only what this run needs)
Check whether \`.hover/hover-map.md\` already exists.
- **It exists → you're EXTENDING.** Read it + call \`recall_business_knowledge\`, then go straight to Phase 2 and cover the uncovered \`[ ]\` lines. Skip the Phase-1 code-mapping — the map already IS the plan. Only re-map if the user says the app changed.
- **It's absent → you're BOOTSTRAPPING.** Do the full Phase 1 below to build the map first.
This keeps a returning run cheap: you don't re-derive a map you already have.

## Ground rules (they protect record==replay AND the user's real app)
- **Grounded targets only.** Pass role+name EXACTLY as they appear in the LATEST \`browser_snapshot\`. If a locate fails, re-snapshot and read the real target — never guess, invent, or reuse a stale name.
- **It's the user's REAL app.** Avoid irreversible / destructive actions — real payments, deleting data you didn't create, sending real emails or SMS — unless the user confirms this is a safe test environment. When unsure, ASK first.
- **Assert stable outcomes.** Assert on semantic, durable signals (a success message, a heading, a new row's label) — NEVER volatile instance data (timestamps, generated ids, "today", a one-off order number), which makes the saved spec flaky on replay.
- **Log in first.** If the app needs auth, do that before anything else — ask for credentials if you don't have them — then crystallize it as its own "Log in" spec and stay logged in for the rest of the run.

Work in PHASES — this is what lets it scale from a tiny app to a large one.

## Phase 1 — Map the business lines (read the CODE, don't click around)
- FIRST call \`recall_business_knowledge\` — rules earlier runs learned (and read \`.hover/hover-map.md\` if it exists, the running map; CONTINUE it, don't start over). Treat both as ground truth; don't re-ask what they already answer. For an app with many remembered rules this returns an INDEX (one line per rule); when a rule is relevant to what you're about to test, pull its full text with \`recall_fact("<name>")\`.
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
- Then call \`lint_map\` to catch wiki drift you may have introduced (a covered line whose spec now fails, a stale spec reference, a spec no line maps) and fix or report it. \`/mcp__hover__lint\` runs the deeper check any time.

## Phase 5 — Lift shared flows into Page Objects (ASK first)
Once specs are crystallized, call \`detect_shared_flows\`. If it reports a NON-login flow repeated across specs (login is already handled by the auth setup), tell the user which specs share it and ASK whether to lift it into a shared Page Object (so a UI change to that flow is a one-place fix). On yes → \`extract_page_objects\` (generates \`pages/*\` + \`fixtures.ts\` and folds the specs to \`await xPage.x()\`). If nothing is shared, skip silently — most small suites have nothing to lift; don't force it.

## Understand the business — ASK, then REMEMBER
When you genuinely can't resolve something on your own — is this a bug or by-design? which flows matter? what does this domain term mean? — ASK the user (don't guess, don't stop). When they confirm a durable business RULE, call \`record_fact\` to persist it (RULES ONLY — never credentials/secrets/PII). Also ASK when blocked on something only they can provide (login credentials, a file). Stay on the app under test — never navigate to external origins.`;
}
