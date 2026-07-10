import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HoverMcpController } from './controller.js';

/* Wrap the controller as an MCP server. Tool names + the GROUNDED target shape
 * mirror Hover's control MCP so an agent that knows one knows the other. Every
 * handler returns text (✓/✗) and never throws — a failed locate/action becomes
 * a ✗ message the calling agent can react to, not an MCP transport error. */

const md = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const errLine = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

/** Common language-code aliases → a name the model reads unambiguously. Anything
 *  else passes through verbatim (so HOVER_LANG=Français or =中文 also works). */
const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese (简体中文)', 'zh-cn': 'Chinese (简体中文)', 'zh-hans': 'Chinese (简体中文)',
  'zh-tw': 'Chinese (繁體中文)', 'zh-hant': 'Chinese (繁體中文)',
  ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
};

/** A prompt prefix telling the agent which language to CONVERSE in with the user.
 *  Empty for English / unset (the default). Code stays English regardless — we
 *  localize the interaction, not the artifacts. */
export function languageDirective(lang?: string): string {
  const raw = (lang ?? '').trim();
  if (!raw || /^(en|en-.*|english)$/i.test(raw)) return '';
  const name = LANG_NAMES[raw.toLowerCase()] ?? raw;
  return (
    `IMPORTANT — Communicate with the user in ${name}: every question you ask, ` +
    `status update, summary, and explanation must be in ${name}. Keep code, spec / ` +
    `test names, identifiers, file paths, and \`slash-commands\` in English. Only the ` +
    `human-facing prose is translated.\n\n`
  );
}

/** Localized `/mcp__hover__*` menu text (title + description shown in the
 *  slash-command picker). HOVER_LANG accepts arbitrary values, so we can only
 *  ship tables for the languages we've translated; everything else falls back
 *  to the English registered inline. Simplified-Chinese only for now — it's the
 *  install language most asked for. Arg NAMES stay English (identifiers), same
 *  rule as languageDirective. Keep in sync when an English description changes. */
type PromptMeta = { title: string; description: string };
const PROMPT_ZH: Record<string, PromptMeta> = {
  test_app: {
    title: 'Hover — 梳理业务并结晶测试套件',
    description: '梳理这个应用的业务线,并结晶出一套 Playwright 测试(增量式,可扩展到大型应用)。',
  },
  optimize: {
    title: 'Hover — 用观察到的断言丰富测试',
    description:
      '改进已结晶的测试:为录制会话观察到的结果补断言、把易变值去字面化、复用 Page Object。传入某个 spec 只优化它,省略则优化全部。以候选形式提交审阅,绝不覆盖你的 spec。',
  },
  lint: {
    title: 'Hover — 检查测试 wiki 健康度',
    description:
      '体检 .hover/:确定性漂移(失效的 spec 引用、覆盖回退、未上图的 spec),加上 LLM 判定的检查(规则冲突、代码路由未上图),然后给出修复建议。',
  },
  ask: {
    title: 'Hover — 向测试 wiki 提问',
    description:
      '基于应用的 .hover/ wiki(业务地图 + 记住的规则 + specs + 运行日志)回答问题,带引用出处。只读;可把确认的新规则回写。',
  },
  heal: {
    title: 'Hover — 修复漂移的 spec',
    description:
      '把已存的 spec 对着活应用重放;UI 漂移的地方,重新定位断掉的步骤并重新结晶。传入某个 spec 修复它,省略则检查全部。',
  },
  guard: {
    title: 'Hover — 声明 guard(先定义行为)',
    description:
      '在写代码之前,把功能意图变成一个声明式 guard:业务规则 + 业务地图上的待办行 + 验收标准。不写代码、不造假 spec——可执行的 spec 稍后录制生成。',
  },
  build: {
    title: 'Hover — 把声明的 guard 建到全绿',
    description:
      '把一个已声明的 guard 驱动到全绿:实现、在活应用里对照验收标准验证、结晶录制的 spec、跑完整回归、push、读 Hover Cloud 的裁决,并分派修复直到全部绿。',
  },
};

/** True when HOVER_LANG names any Chinese variant (zh, zh-CN, 中文, chinese…). */
export function isZhLang(raw?: string): boolean {
  const s = (raw ?? '').trim().toLowerCase();
  return /^zh(\b|-)/.test(s) || s === 'chinese' || /中文/.test(raw ?? '');
}

/** Pick the localized menu meta when we have a table for this language, else
 *  return the English one passed inline at the registration site. */
function promptMeta(zh: boolean, name: string, en: PromptMeta): PromptMeta {
  return zh && PROMPT_ZH[name] ? PROMPT_ZH[name] : en;
}

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

/** Options for the MCP server. `lang` (from HOVER_LANG) makes the workflow
 *  prompts tell the agent which language to CONVERSE in with the user. */
export interface HoverServerOptions {
  lang?: string;
}

/*
 * ─── One capability, one home: tools vs prompts (vs hooks) ───────────────────
 * Keep the surface non-overlapping by registering each capability on exactly
 * ONE axis:
 *
 *   registerTool   = a PRIMITIVE the agent calls mid-reasoning (read a snapshot,
 *                    click, record a fact, replay a spec, lint_map, cloud_*,
 *                    declare_guard). Composable, idempotent/side-effect-scoped.
 *   registerPrompt = a user-typed `/mcp__hover__*` WORKFLOW that orchestrates
 *                    those primitives (test_app, guard, build, heal, optimize,
 *                    lint, ask).
 *   (hooks)        = automatic lifecycle triggers that SURFACE/NUDGE — plus one
 *                    opt-in deterministic Stop GATE (`install --gate`) — using
 *                    the same primitives; never orchestrate or auto-fix. See
 *                    hook.ts.
 *
 * Rules to keep it clean:
 *  - Never register the SAME workflow as both a prompt and a tool (no
 *    `start_guard` tool mirroring the `/guard` prompt — the agent can't invoke
 *    a prompt, but it can compose the primitives, so the prompt stays the sole
 *    orchestration entry).
 *  - A workflow reusing a primitive is expected (the `/lint` prompt builds on
 *    the `lint_map` tool; `/optimize` loops over `optimize_brief`). That is
 *    layering, not duplication.
 *  - Name them apart on purpose: workflow = plain verb (`lint`, `optimize`,
 *    `guard`); primitive = specific (`lint_map`, `optimize_brief`,
 *    `declare_guard`).
 */
export function createHoverMcpServer(c: HoverMcpController, opts: HoverServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'hover', version: '0.1.0' });
  const guard = (fn: () => Promise<string>) => fn().then(md, (e) => md(`✗ ${errLine(e)}`));
  const lang = languageDirective(opts.lang);
  const zh = isZhLang(opts.lang); // localize the /mcp__hover__* menu text too

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
        line: z
          .string()
          .optional()
          .describe(
            "The business line this rule governs, named EXACTLY as it appears in .hover/hover-map.md (e.g. 'Log in', 'Checkout'). Anchors the rule to that line so it surfaces with the line. Omit for an app-wide rule (theming, global auth) that no single line owns.",
          ),
      },
    },
    ({ title, rule, type, line }) => guard(() => c.recordFact(title, rule, type ?? 'business-rule', line)),
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

  server.registerTool(
    'verify_specs',
    {
      description:
        "The inner-loop check: after editing code, verify the app's flows still pass — BEFORE pushing. mode 'fast' (default) replays each spec's recorded grounded steps against the live app in seconds; mode 'faithful' runs the real spec files via `playwright test` (the same engine + files CI runs — use once before a push). Returns structured pass/drift/blocked per spec with the exact broken step. Read-only and advisory: local green = worth pushing; CI remains the source of truth. A failure right after YOUR edit usually means the edit broke the flow — fix the code, don't heal.",
      inputSchema: {
        specs: z.array(z.string()).optional().describe('Spec slugs to verify (e.g. ["checkout","log-in"]). Omit to verify every crystallized spec.'),
        mode: z.enum(['fast', 'faithful']).optional().describe("'fast' = replay recorded steps (seconds, default). 'faithful' = run the real spec files with playwright test, exactly like CI."),
      },
    },
    ({ specs, mode }) => guard(() => c.verifySpecs(specs, mode ?? 'fast')),
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
  // brief); these tools are Hover's guardrail + write path.
  server.registerTool(
    'optimize_brief',
    {
      description:
        "Get the improvement brief for ONE spec (its current code + the outcome its recording session observed + your Page Objects + the improvement rules). Use this when optimizing every spec (`/mcp__hover__optimize` with no arg): call it per spec, follow the brief it returns, then call save_optimized_spec. For a single spec, `/mcp__hover__optimize <slug>` already hands you the brief.",
      inputSchema: {
        slug: z.string().describe('The spec slug to optimize (its filename without .spec.ts).'),
      },
    },
    ({ slug }) => guard(() => c.optimizeBrief(slug)),
  );

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

  server.registerTool(
    'promote_optimized_spec',
    {
      description:
        "Apply a reviewed optimization candidate: overwrite __vibe_tests__/<slug>.spec.ts with its .hover/cache/optimized/<slug>.spec.ts.draft and remove the draft. Call this ONLY after the user has seen the diff and approved — it's the one action that replaces the original spec. Re-validates the draft first.",
      inputSchema: {
        slug: z.string().describe('The spec slug whose candidate to promote (its filename without .spec.ts).'),
      },
    },
    ({ slug }) => guard(() => c.promoteOptimized(slug)),
  );

  server.registerTool(
    'cloud_context',
    {
      description:
        "Orient yourself with Hover Cloud when signed in: who you're connected as, whether THIS repo is a Cloud project (its org + environments with URLs + test accounts), and which environment is active in the editor (what a drive/heal targets). Call it first to know the lay of the land. Needs a connected cloud account (HOVER_CLOUD_TOKEN or ~/.hover/credentials.json).",
      inputSchema: {},
    },
    () => guard(() => c.cloudContext()),
  );

  server.registerTool(
    'cloud_failures',
    {
      description:
        "Hover Cloud's open heal queue: the specs whose CI runs drifted (each with its failing locator, the environment it drifted on + that env's URL, branch, and CI link). Heal one locally with `/mcp__hover__heal <slug>` — activate the drifted environment first. An entry closes automatically when CI next sees that spec pass. Needs a connected cloud account (HOVER_CLOUD_TOKEN or ~/.hover/credentials.json).",
      inputSchema: {
        repo: z.string().optional().describe('Limit to one GitHub repo ("owner/name"). Omit for all your projects.'),
      },
    },
    ({ repo }) => guard(() => c.cloudFailures(repo)),
  );

  server.registerTool(
    'cloud_run_result',
    {
      description:
        "One ingested CI run + what each failure MEANS: per-spec status, the deterministic verdict (drift = heal the test / bug = fix the app / unclear), and the advisory LLM judge (score + lean + rationale). The build loop's eyes after a push. Pending = CI hasn't reported yet; poll again in ~30-60s. Needs a connected cloud account.",
      inputSchema: {
        sha: z.string().optional().describe('The pushed commit sha (short or full). Omit for the project’s latest ingested run.'),
        repo: z.string().optional().describe('GitHub repo "owner/name". Omit to detect from the git origin.'),
      },
    },
    ({ sha, repo }) => guard(() => c.cloudRunResult(sha, repo)),
  );

  server.registerTool(
    'declare_guard',
    {
      description:
        'Declare a guard (the RED light of guard-first development): write a pending `- [ ]` business line + its acceptance criteria onto .hover/hover-map.md, BEFORE the feature is implemented. The spec itself is still RECORDED later (crystallize_spec) — never write Playwright for UI that does not exist. Record the intent’s business rules separately via record_fact.',
      inputSchema: {
        area: z.string().describe('Map area (## section) the line belongs to, e.g. "Practice". Created if new.'),
        line: z.string().describe('The business-line name, e.g. "Daily check-in". Short, imperative, user-facing.'),
        route: z.string().optional().describe('Entry route, e.g. "/checkin". Omit if not yet decided.'),
        criteria: z
          .array(z.string())
          .describe('Acceptance criteria, in order — the outcomes the recorded spec must assert, e.g. ["clicking Check in shows 已打卡", "7-day streak shows a badge on /stats"].'),
      },
    },
    ({ area, line, route, criteria }) => guard(() => c.declareGuard(area, line, criteria, route)),
  );

  // The workflow ships WITH the server as an MCP prompt — Claude Code surfaces
  // it as `/mcp__hover__test_app`, so adding the server brings both the tools
  // AND the command. No project scaffolding needed.
  server.registerPrompt(
    'test_app',
    {
      ...promptMeta(zh, 'test_app', {
        title: 'Hover — map & crystallize a test suite',
        description: "Map this app's business lines and crystallize a Playwright suite (incremental, scales to large apps).",
      }),
      argsSchema: { scope: z.string().optional().describe('An area/flow to focus on. Omit to cover the whole app.') },
    },
    ({ scope }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: lang + workflowPrompt(scope) } }],
    }),
  );

  // Optimize workflow — surfaced as `/mcp__hover__optimize`. Hover builds the
  // brief (spec + observed session + Page Objects); the agent does the thinking.
  server.registerPrompt(
    'optimize',
    {
      ...promptMeta(zh, 'optimize', {
        title: 'Hover — enrich specs with observed assertions',
        description: 'Improve crystallized specs: add assertions for what the session observed, de-literalize volatile values, reuse Page Objects. Pass a spec to optimize one, or omit to optimize every spec. Files review candidates; never overwrites a spec.',
      }),
      argsSchema: { spec: z.string().optional().describe('A spec slug to optimize (e.g. "checkout"). Omit to optimize EVERY spec.') },
    },
    async ({ spec }) => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: lang + (spec?.trim() ? await c.optimizeBrief(spec.trim()) : optimizeAllPrompt()) },
        },
      ],
    }),
  );

  // Wiki-lint workflow — surfaced as `/mcp__hover__lint`. The tool does the
  // mechanical checks; the prompt drives the LLM-judged half on top.
  server.registerPrompt(
    'lint',
    {
      ...promptMeta(zh, 'lint', {
        title: 'Hover — lint the test wiki',
        description: 'Health-check .hover/: deterministic drift (dead spec refs, regressed coverage, unmapped specs) plus LLM-judged checks (contradictory rules, code routes missing from the map), then offer fixes.',
      }),
      argsSchema: {},
    },
    () => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: lang + lintPrompt() } }],
    }),
  );

  // Query workflow (LLM-Wiki P4) — surfaced as `/mcp__hover__ask`. Read the wiki,
  // answer with citations, optionally file a confirmed new rule back.
  server.registerPrompt(
    'ask',
    {
      ...promptMeta(zh, 'ask', {
        title: 'Hover — ask the test wiki',
        description: 'Answer a question about this app from its .hover/ wiki (business map + remembered rules + specs + run log), with citations. Read-only; can file a confirmed new rule back.',
      }),
      argsSchema: { question: z.string().describe('The question to answer, e.g. "what happens when a guest tries to check out?"') },
    },
    ({ question }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: lang + askPrompt(question) } }],
    }),
  );

  // Self-heal workflow — surfaced as `/mcp__hover__heal`.
  server.registerPrompt(
    'heal',
    {
      ...promptMeta(zh, 'heal', {
        title: 'Hover — heal a drifted spec',
        description: 'Replay a saved spec against the live app; where the UI drifted, re-ground the broken step and re-crystallize. Pass a spec to heal one, or omit to check all.',
      }),
      argsSchema: { spec: z.string().optional().describe('A spec slug to heal (e.g. "login"). Omit to check every spec.') },
    },
    ({ spec }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: lang + healPrompt(spec) } }],
    }),
  );

  // Guard-first development, step 1 — surfaced as `/mcp__hover__guard`.
  // Declares WHAT SHOULD BE TRUE before any code exists: rules + a pending map
  // line + acceptance criteria. The red light; /mcp__hover__build is the loop
  // that drives it green.
  server.registerPrompt(
    'guard',
    {
      ...promptMeta(zh, 'guard', {
        title: 'Hover — declare a guard (define the behavior first)',
        description:
          'Turn a feature intent into a declared guard BEFORE implementation: business rules + a pending line on the business map + acceptance criteria. No code, no fake specs — the executable spec is recorded later.',
      }),
      argsSchema: {
        intent: z.string().describe('The feature intent in plain words, e.g. "daily check-in; 7-day streak shows a badge on the stats page".'),
      },
    },
    ({ intent }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: lang + guardPrompt(intent) } }],
    }),
  );

  // Guard-first development, step 2 — surfaced as `/mcp__hover__build`.
  server.registerPrompt(
    'build',
    {
      ...promptMeta(zh, 'build', {
        title: 'Hover — build a declared guard to green',
        description:
          'Drive a declared guard to green: implement, verify against the acceptance criteria in the live app, crystallize the recorded spec, run the full regression, push, read Hover Cloud’s verdicts, and dispatch fixes until everything is green.',
      }),
      argsSchema: {
        line: z.string().describe('The declared business line to build, exactly as on the map, e.g. "Daily check-in".'),
      },
    },
    ({ line }) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: lang + buildPrompt(line) } }],
    }),
  );

  return server;
}

/** Guard declaration workflow — intent → rules + pending map line. The RED
 *  light: declarative, human-confirmed, zero fabricated Playwright. */
function guardPrompt(intent: string): string {
  return `Declare a GUARD for this app — define what should be true BEFORE any code exists. Do NOT implement anything and do NOT write any Playwright in this workflow.

Intent (from the user):
"""
${intent}
"""

1. **Ground yourself.** Call \`recall_business_knowledge\` and read \`.hover/hover-map.md\` (your file tools) so the new guard fits the existing map (reuse an existing area if one fits) and doesn't contradict a known rule. If it CONTRADICTS one, stop and surface the conflict — the user decides which holds.

2. **Interview the gaps — ONE message.** Ask only what the intent leaves genuinely ambiguous, the things code can't reveal later: edge behavior (what happens on the boundary?), access (logged-out? which roles?), invariants (once per day? resets when?), and where it lives (route / entry point). Don't ask what the intent already answers.

3. **Record the rules.** For each durable rule the user confirms (or the intent clearly states), call \`record_fact\` with \`line\` set to the business line's name — these are what Hover Cloud's judge will score future failures against, so state each as a clean, testable sentence.

4. **Declare the line.** Call \`declare_guard\` with the area, the line name, the route (if known), and the ACCEPTANCE CRITERIA — the ordered, observable outcomes the future spec must assert (each criterion should name a visible outcome, e.g. 'clicking "打卡" shows "已打卡"'). This writes a pending \`- [ ]\` line on the business map: a visible, uncovered contract.

5. **Confirm and stop.** Show the user what was declared — the rules, the line, the criteria — and STOP. Implementation is a separate step: \`/mcp__hover__build ${'{'}the line name${'}'}\`. Do not start it unbidden.

Rules: RULES ONLY in memory (never secrets/PII). Never mark the line covered — coverage is earned by a recorded spec, not declared. If the user says "just decide", make the smallest reasonable call and note it as an assumption in the acceptance Note.`;
}

/** Build-loop workflow — drive a declared guard to green. Inner loop local,
 *  outer loop CI + Hover Cloud verdicts. The agent implements; Hover verifies,
 *  records, and adjudicates. */
function buildPrompt(line: string): string {
  return `Build the declared guard **"${line}"** to green — implement it, verify it against its acceptance criteria in the LIVE app, crystallize the recorded spec, and iterate on Hover Cloud's CI verdicts until everything is green.

## Ground rules (read first)
- **Never weaken, delete, or rewrite acceptance criteria or existing assertions to make something pass.** If making it pass would require changing what "correct" means, the intent changed — STOP and tell the user to re-run \`/mcp__hover__guard\`.
- **Budget: ~10 inner-loop rounds, ~3 CI rounds.** If you hit either limit, stop and report exactly where it stands and what's blocking.
- It's the user's real app — same safety rules as any Hover run (no destructive actions without confirmation).

## Setup
Read the guard: find "${line}" on \`.hover/hover-map.md\` (its route + acceptance Note) and \`recall_business_knowledge\` for its rules. If the line isn't declared, stop — run \`/mcp__hover__guard\` first.

## Inner loop (local, repeat until the walk passes)
1. **Implement** the feature in the app's codebase with your own tools — your code, your conventions. Hover doesn't write app code.
2. **Verify in the live app**: \`browser_navigate\` to the route → \`browser_snapshot\` → walk the flow with the grounded \`*_control\` tools → \`assert_visible\` EACH acceptance criterion, in order.
3. A criterion fails → fix the CODE (never the criterion) → repeat.
4. All criteria pass → \`crystallize_spec("${line}")\` — the spec is now RECORDED from the real flow (record == replay). This flips the map line to covered.
5. **Protect the estate (fast, every round)**: \`verify_specs\` (default mode "fast") — replays every crystallized flow against the live app in seconds. A failure right after YOUR edit means the edit broke that flow → fix the CODE (never heal here). A \`blocked\` result is a setup problem (missing credentials) — surface it, don't treat it as drift.

## Pre-push check
6. \`verify_specs\` with mode "faithful" — runs the REAL spec files through \`playwright test\`, the same engine and files CI runs. Green here = worth pushing; red here would have been red in CI, so fix it now and save a CI round.

## Outer loop (CI + Hover Cloud, repeat until green)
7. Commit on a feature branch and push (open a PR if there isn't one). Note the commit sha.
8. Poll \`cloud_run_result\` with that sha (CI takes minutes — wait ~60s between polls; it answers "pending" until the run is ingested).
9. Dispatch each failing spec by its verdict:
   - **The new "${line}" spec fails** → the implementation doesn't meet the declared intent → back to the inner loop.
   - **An existing spec fails, verdict \`bug\`** → your change broke existing behavior → fix the code.
   - **An existing spec fails, verdict \`drift\` (or the judge strongly leans drift)** → the old spec is outdated BY THIS INTENT → heal it: \`/mcp__hover__heal <slug>\` flow (replay, re-ground, re-crystallize). Only heal specs whose change traces to this feature.
   - **Verdict \`unclear\` with no strong judge lean** → do NOT guess. Stop and ask the user to rule on it (it's in the Hover Cloud heal queue with a screenshot).
10. Push the fixes; repeat from 8.

## Done
The run comes back green (\`cloud_run_result\` reports all specs passing). Report: what was implemented, the spec recorded, any old specs healed (and why that was correct per the new intent), rules touched, and that the PR is ready for the user's review — merging is theirs, always.`;
}

/** Optimize-ALL workflow body: enrich every spec, one at a time. Each spec's
 *  brief comes from the optimize_brief tool (same brief the single-spec prompt
 *  delivers inline), so quality is identical; only the loop differs. */
function optimizeAllPrompt(): string {
  return `Optimize EVERY crystallized spec for this app using the **Hover MCP tools** — enrich each with the assertions its recording session observed, without changing what it tests.

1. **List the specs** — the \`*.spec.ts\` files under \`__vibe_tests__/\` (skip \`*.api-test.spec.ts\` and \`pages/\`). Use your own file tools.
2. **For each spec, ONE at a time:**
   - \`optimize_brief("<slug>")\` — returns that spec's current code + the outcome its session observed + your Page Objects + the improvement rules.
   - Follow the brief: add assertions for the observed feedback, de-literalize volatile values (a generated id, an order number → a stable anchor), reuse a Page Object where a step sequence matches. Don't invent steps the session didn't perform.
   - \`save_optimized_spec("<slug>", <the complete improved .ts>)\` — Hover validates it and files a candidate at \`.hover/cache/optimized/<slug>.spec.ts.draft\`. It NEVER overwrites your spec. On a ✗, fix it and call again.
3. **Be selective per spec** — only add assertions that matter (a real outcome, a stable heading). A spec that's already tight needs no candidate; skip it and say so. Over-asserting a changing value is the failure we're avoiding.
4. **Report + apply** — list which specs got a candidate. For each, show the user the diff vs \`__vibe_tests__/<slug>.spec.ts\`; on their approval call \`promote_optimized_spec("<slug>")\` to apply it (overwrites the spec + removes the draft — no manual mv). Nothing lands until they approve.`;
}

/** Query workflow body (LLM-Wiki P4): read the wiki, answer with citations, and
 *  optionally file a confirmed new rule back so the next question is cheaper. */
function askPrompt(question: string): string {
  return `Answer a question about this app using its **test wiki** (\`.hover/\`) as the source of truth. The wiki = the business map (\`.hover/hover-map.md\`), the remembered business rules (\`.hover/memory/\` — via \`recall_business_knowledge\` / \`recall_fact\`), the crystallized specs under \`__vibe_tests__/\`, and the run history (\`.hover/log.md\`).

Question: ${question}

1. **Gather (read-only — don't drive the browser).** Call \`recall_business_knowledge\` for the rule index and pull specifics with \`recall_fact\`. Read \`.hover/hover-map.md\` for the business lines, coverage, and relationships. Skim the relevant \`*.spec.ts\` and \`.hover/log.md\` with your own file tools.
2. **Answer directly, with CITATIONS.** Ground every claim in what you read — name the rule, the business line, or the spec file it came from. If the wiki genuinely doesn't cover it, say so plainly instead of guessing (and suggest running \`/mcp__hover__test_app\` to cover that area).
3. **Optionally file it back.** If answering established a durable business RULE the wiki was missing and the user confirms it, persist it with \`record_fact\` (RULES only — never secrets / credentials / PII) so the next run doesn't re-derive it.

Stay on what the wiki + code actually say; don't invent behavior.`;
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

Drift found in CI (a Hover Cloud heal request)? Call \`cloud_failures\` first — it lists each drifted spec's slug, failing locator, and branch, so you know what to heal and why.

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
- **Large app? Fan this reading out.** Phase 1 is pure code-reading — no browser, no shared state — so if your agent can spawn sub-agents / parallel tasks, split the codebase by area (or route group) and map them concurrently, each sub-agent returning its area's business lines + routes + relationships; then YOU merge them into the single map below. This is the ONE parallelizable phase — Phase 3 records against a single shared browser and stays strictly sequential. Skip the fan-out for a small app; it's not worth the overhead.
- Write/update \`.hover/hover-map.md\` as a checklist (4-space indent = a code block):

        # Business map — <app>
        ## Auth
        - [ ] Log in — /login
        - [x] Checkout — /checkout — checkout.spec.ts
        ## Relationships
        - Checkout depends-on Log in
        - Cart shares-state Checkout

- Optionally add a \`## Relationships\` block recording inter-line edges you notice — \`<line> depends-on <line>\`, \`<line> shares-state <line>\`, or \`<line> navigates-to <line>\` (names must match lines above). These become graph edges in the cockpit's Business Map; they also tell a later run what a flow depends on. Record only real edges; skip the block if none stand out.
- Don't test yet. For a large app, this map IS the plan.

## Phase 1.5 — Confirm the business with the user (bootstrap only)
On a FIRST run (no pre-existing map), show the user the business lines you drafted and ask — in ONE message, before testing:
1. **Priority** — which lines matter most / which to cover now (this absorbs Phase 2's scope question; offer "all").
2. **Invisible rules** — what the code doesn't show: roles/permissions ("which features need login?"), paywalls/quotas, is this a safe test environment (real payments? real emails?), known trouble spots.
3. **Corrections** — lines that are wrong, missing, or mis-grouped.

\`record_fact\` each durable rule they confirm — this single checkpoint is where the app's business knowledge base gets seeded. If they say "just proceed" (or don't engage), continue with your inferred map — the checkpoint is one message, never a gate. On an EXTEND run (a map already exists), SKIP this — recall + the map already hold the answers; only surface a contradiction.

## Phase 2 — Pick the scope
- If a scope was given, cover that. On a bootstrap run the scope question was already asked in Phase 1.5. Otherwise (extend run, no scope given) show the uncovered lines and ask which to cover now (offer "all uncovered"); for a small app, just cover them all.

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

## Understand the business — OBSERVE, ASK, REMEMBER
The knowledge base only compounds if you actually write to it — every run should leave \`.hover/memory/\` knowing more than it started:
- **Observed → record directly.** When the app itself demonstrates a durable rule, \`record_fact\` it without asking — a redirect to /login proves that feature needs auth; a limit message proves a quota; a disabled button for this role proves a permission. State it as a clean rule ("Word practice requires a signed-in user").
- **Ambiguous → ASK, don't guess.** Bug or by-design? Which flows matter? What does this domain term mean? ASK the user (don't guess, don't stop). Batch small confirmations at natural pauses (end of a line, end of the run) instead of interrupting per item. When they confirm a rule, \`record_fact\` it.
- **Anchor each rule to its line.** When a rule governs a specific business line, pass \`record_fact\`'s \`line\` = that line's name EXACTLY as in \`.hover/hover-map.md\` (a rule about the login flow -> \`line: "Log in"\`), so it hangs under that line in the map. Leave \`line\` blank only for a genuinely app-wide rule (theming, global auth policy) no single line owns.
- RULES ONLY — never credentials/secrets/PII. Also ASK when blocked on something only they can provide (login credentials, a file). Stay on the app under test — never navigate to external origins.`;
}
