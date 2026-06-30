import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * `hover init` — the Model-A installer. Scaffolds Hover into the user's project
 * so their OWN agent (Claude Code) becomes the driver:
 *   - .mcp.json         registers the `hover` MCP server (grounded tools + crystallize_spec)
 *   - .claude/commands/hover.md   the `/hover` workflow command (map → crystallize a suite)
 * Then the user works entirely in Claude Code's TUI: `/hover` (or "test my app
 * with hover"). No separate Hover TUI needed for this path.
 */

export interface InitOptions {
  /** Project root to scaffold into. */
  cwd: string;
  /** Dev-server origin the agent should drive. */
  target: string;
  /** Command that launches hover-mcp (e.g. the node binary, or `hover-mcp`). */
  mcpCommand: string;
  /** Args for the launch command (e.g. the absolute path to mcp.js). */
  mcpArgs: string[];
}

export interface InitResult {
  files: string[];
  mcpServerName: string;
}

/** The /hover command — a phased, scale-aware workflow: map the business lines
 *  by READING THE CODE (cheap + complete), then cover them flow-by-flow with the
 *  hover-mcp tools, persisting coverage in .hover/hover-map.md so a large app can
 *  be covered in resumable batches. Per-flow crystallize matches the MCP buffer
 *  semantics (each crystallize_spec saves the grounded actions since the last). */
export const HOVER_COMMAND_MD = `---
description: Map this web app's business lines and crystallize a Playwright suite — incremental, scales to large apps
---

Build (or extend) a Playwright test suite for this app using the **Hover MCP tools**.
Drive the browser ONLY through these tools — they actuate via grounded selectors
(role+name → testId → text), so every spec you save replays EXACTLY what you did
(record==replay). Never write spec files yourself; only \`crystallize_spec\` does.

Tools: \`recall_business_knowledge\` · \`browser_navigate\` · \`browser_snapshot\` (ARIA
tree — read before acting) · \`click_control\` / \`fill_control\` / \`select_control\` /
\`check_control\` (grounded target from the snapshot) · \`assert_visible\` ·
\`record_fact\` · \`crystallize_spec(name, description?)\`.

Target: the app at HOVER_TARGET (set in .mcp.json). Scope: $ARGUMENTS — an area/flow, or empty = the whole app.

Work in PHASES — this is what lets it scale from a tiny app to a large one.

## Phase 1 — Map the business lines (read the CODE, don't click around)
- FIRST call \`recall_business_knowledge\` — rules earlier runs learned (and read \`.hover/hover-map.md\` if it exists, the running map; CONTINUE it, don't start over). Treat both as ground truth; don't re-ask what they already answer.
- Use YOUR OWN file tools (read / grep / glob) to find the app's ROUTES + navigation: the router config, route/page files, the nav components. Enumerate the user-facing BUSINESS LINES (a coherent task a user performs), each with its entry route, grouped by area. Reading code is cheaper + more complete than clicking around, and it finds areas behind auth / nav you'd otherwise miss.
- Write/update \`.hover/hover-map.md\` as a checklist (4-space indent = a code block):

        # Business map — <app>
        ## Auth
        - [ ] Log in — /login
        - [x] Checkout — /checkout — checkout.spec.ts
        ## Commerce
        - [ ] Browse products — /products

- Don't test yet. For a large app, this map IS the plan.

## Phase 2 — Pick the scope
- If $ARGUMENTS names an area/flow, cover that. Otherwise show the uncovered lines and ask which to cover now (offer "all uncovered"). For a small app, just cover them all.

## Phase 3 — Cover each chosen line, ONE AT A TIME
For each line: \`browser_navigate\` to its route → \`browser_snapshot\` → EXERCISE the real flow (click / fill / select / check — you are a tester, never just describe the page) → \`assert_visible\` on the OUTCOME (a success message, the new row, the next screen) → \`crystallize_spec("<short imperative English name>")\`. Crystallize the MOMENT each flow is done, before the next — the buffer is per-flow.
- The tools share ONE browser, so cover lines SEQUENTIALLY — never in parallel. If your agent can dispatch a subagent per line for context isolation, do so one at a time (each subagent drives the hover tools + crystallizes its single flow).

## Phase 4 — Update coverage
- Mark each covered line \`[x]\` in \`.hover/hover-map.md\` with its spec filename. Report covered vs still-open.
- A LARGE app does NOT have to finish in one run: covering a batch + updating the map is a complete, resumable unit — re-run /hover to read the map and continue the uncovered lines.

## Understand the business — ASK, then REMEMBER
You are in the user's editor, so when you genuinely can't resolve something on your own — is this behavior a bug or by-design? which flows actually matter? what does this domain term mean? — just ASK the user in the chat (don't guess, don't stop). When they confirm a durable business RULE, call \`record_fact\` to persist it (RULES ONLY — never credentials/secrets/PII) so neither you nor a future run re-asks it. Also ASK when blocked on something only they can provide (login credentials, a file to upload), then continue.

Stay on the app under test — never navigate to external origins.
`;

/** Merge the hover MCP server into .mcp.json (preserving any existing servers)
 *  and write the /hover command. Idempotent — safe to re-run. */
export function runInit(opts: InitOptions): InitResult {
  const files: string[] = [];

  // .mcp.json — merge, don't clobber other servers.
  const mcpPath = join(opts.cwd, '.mcp.json');
  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    try {
      config = JSON.parse(readFileSync(mcpPath, 'utf8')) as typeof config;
    } catch {
      config = {}; // unparseable — start fresh (overwrites; the user can re-add)
    }
  }
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers.hover = {
    command: opts.mcpCommand,
    args: opts.mcpArgs,
    env: { HOVER_TARGET: opts.target, HOVER_PROJECT_ROOT: opts.cwd },
  };
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  files.push(mcpPath);

  // .claude/commands/hover.md — the /hover workflow command.
  const cmdDir = join(opts.cwd, '.claude', 'commands');
  mkdirSync(cmdDir, { recursive: true });
  const cmdPath = join(cmdDir, 'hover.md');
  writeFileSync(cmdPath, HOVER_COMMAND_MD);
  files.push(cmdPath);

  return { files, mcpServerName: 'hover' };
}
