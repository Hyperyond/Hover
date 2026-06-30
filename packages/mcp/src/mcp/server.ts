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
\`record_fact\` · \`crystallize_spec(name, description?)\`.

Target: the app at HOVER_TARGET (set in the server's env). Scope: ${target}.

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

## Phase 4 — Update coverage
- Mark each covered line \`[x]\` in \`.hover/hover-map.md\` with its spec filename. Report covered vs still-open. A LARGE app doesn't have to finish in one go — covering a batch + updating the map is a complete, resumable unit; re-invoke to continue the uncovered lines.

## Understand the business — ASK, then REMEMBER
When you genuinely can't resolve something on your own — is this a bug or by-design? which flows matter? what does this domain term mean? — ASK the user (don't guess, don't stop). When they confirm a durable business RULE, call \`record_fact\` to persist it (RULES ONLY — never credentials/secrets/PII). Also ASK when blocked on something only they can provide (login credentials, a file). Stay on the app under test — never navigate to external origins.`;
}
