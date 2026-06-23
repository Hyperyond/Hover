#!/usr/bin/env node
/**
 * Hover control-actuation MCP server — always spawned alongside Playwright MCP.
 *
 * Why it exists: the Playwright MCP's `browser_click` does strict actionability,
 * so it can't toggle a "visually-hidden" form control — a real <input> clipped
 * to 1px / opacity-0 behind a styled label (the ubiquitous sr-only radio /
 * checkbox / switch pattern). A human clicks the big label and the browser
 * forwards to the hidden input; Playwright clicks the 1px input and bails with
 * "intercepts pointer events". Before Hover disabled the arbitrary-JS browser
 * tools (run_code / evaluate) the agent could JS-click the input as a fallback;
 * that escape hatch is gone, leaving these controls undriveable.
 *
 * This server restores actuation WITHOUT reopening arbitrary JS: it connects to
 * the same debug Chrome over CDP and runs Playwright's own `.check()` /
 * `.uncheck()` with `{ force: true }` (which skips the actionability hit-test
 * the visible label otherwise fails). Crucially the action is a STANDARD
 * Playwright call, so the crystallizer maps it straight to
 * `page.getByRole(role, { name }).check()` — the saved spec stays deterministic
 * and reproducible (unlike a dropped raw-JS step).
 *
 * Env (set by the host):
 *   HOVER_CDP_URL   CDP endpoint of the debug Chrome (e.g. http://localhost:9222)
 *   HOVER_DEV_URL   the dev-server URL, so we pick the right page by origin
 *
 * Tool:
 *   check_control({ role, name, checked? }) → force-check/uncheck the control
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { chromium, type Page } from 'playwright-core';
import { WebSocket } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const CDP_URL = process.env.HOVER_CDP_URL || 'http://localhost:9222';
const DEV_URL = process.env.HOVER_DEV_URL || '';
const APPROVAL_PORT = process.env.HOVER_APPROVAL_PORT;
const PROJECT_ROOT = process.env.HOVER_PROJECT_ROOT || process.cwd();
/** Where take_screenshot writes its PNGs — the run's `.hover/screenshots/<tag>`
 *  dir, the same one the service scans with newestPng() to surface a shot in the
 *  chat. Set by the host (buildMcpConfig); falls back to the project .hover. */
const SHOT_DIR = process.env.HOVER_SHOT_DIR || join(PROJECT_ROOT, '.hover', 'screenshots');

/** Stable, commit-worthy placeholder fixture path (relative to the project) —
 *  the spec references this so the upload step replays. */
const PLACEHOLDER_REL = '__vibe_tests__/fixtures/hover-placeholder.png';
/** A minimal valid 1×1 PNG — the engine writes this when the user picks
 *  "upload a placeholder" so the agent never has to fabricate a file. */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function md(text: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Candidate-flow capture. Every SUCCESSFUL grounded actuation (click / fill /
 * select / check / upload) is buffered here as a crystallizable step. When the
 * agent calls record_candidate after finishing a flow, we hand it the steps
 * since the previous marker — no fragile step-number citing by the agent (which
 * drifted over long runs). This server is a fresh stdio subprocess per run, so
 * the buffer resets each run automatically. Steps use bare tool names + the same
 * input shape writeSpec.translateStep reads, so they crystallize 1:1.
 */
const candidateSteps: { kind: 'step'; tool: string; input: unknown }[] = [];
let candidateMark = 0;
function noteActuation(tool: string, input: unknown): void {
  candidateSteps.push({ kind: 'step', tool, input });
}

function originOf(u: string): string | null {
  try { return new URL(u).origin; } catch { return null; }
}

/** First line of an error, for a compact tool result. */
function errLine(e: unknown): string {
  return e instanceof Error ? e.message.split('\n')[0] : String(e);
}

/** Human label for a grounded target, for the tool's ✓/✗ result text. */
function describe(g: { role?: string; name?: string; text?: string; testId?: string }): string {
  if (g.role && g.name) return `${g.role} "${g.name}"`;
  if (g.testId) return `testId "${g.testId}"`;
  if (g.text) return `text "${g.text}"`;
  return '(no target)';
}

/** Pick the page on the dev origin (the app under test), else the first page. */
async function pickPage(): Promise<{ page: Page; close: () => Promise<void> } | null> {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5000 });
  } catch {
    return null;
  }
  const close = async (): Promise<void> => { try { await browser.close(); } catch { /* disconnect only */ } };
  const wantOrigin = originOf(DEV_URL);
  const pages: Page[] = browser.contexts().flatMap((c) => c.pages());
  if (pages.length === 0) { await close(); return null; }
  const matches = wantOrigin ? pages.filter((p) => originOf(p.url()) === wantOrigin) : [];
  const candidates = matches.length ? matches : pages;
  // Multiple same-origin tabs (e.g. one opened to escape a dialog) → drive the
  // FOREGROUND one, not whichever happens to be first, so steps don't split
  // across tabs. Fall back to the last (most-recently-opened) match.
  let chosen = candidates[candidates.length - 1];
  for (const p of candidates) {
    try {
      if (await p.evaluate(() => document.visibilityState === 'visible')) { chosen = p; break; }
    } catch { /* page busy/closed — skip */ }
  }
  return { page: chosen, close };
}

/**
 * Build a grounded locator from what the agent read off the snapshot, in
 * preference order: role+name (semantic, survives markup churn — Hover's
 * preferred form) → testId (stable) → text (real visible text). All three are
 * deterministic and crystallize 1:1; the agent never passes a freeform
 * description, so the saved selector can't be a confabulation. Returns null
 * when nothing usable was supplied.
 */
function locate(
  page: Page,
  g: { role?: string; name?: string; text?: string; testId?: string; within?: { role?: string; name?: string } },
): ReturnType<Page['locator']> | null {
  // `within` scopes to a container (e.g. a radiogroup) by role+name first, so a
  // repeated option label ("No" in three Yes/No groups) or a display:none input
  // (not in the a11y tree → unreachable by role) resolves to exactly one match
  // via its visible label inside the right group.
  const base = g.within?.role && g.within?.name
    ? page.getByRole(g.within.role as Parameters<Page['getByRole']>[0], { name: g.within.name, exact: true })
    : page;
  if (g.role && g.name) return base.getByRole(g.role as Parameters<Page['getByRole']>[0], { name: g.name, exact: true });
  if (g.testId) return base.getByTestId(g.testId);
  // .first(): a label-wrapped control's text matches both the <label> and its
  // inner <span> → strict-mode violation. Clicking either forwards to the
  // control, so resolve to the first (the outer label).
  if (g.text) return base.getByText(g.text).first();
  return null;
}

/** Locate a file <input> for upload_file: by its label (aria-label/associated
 *  label), its testId, or — by default — the single file input on the page,
 *  optionally scoped to a `within` container. Resolves hidden inputs too. */
function fileInput(
  page: Page,
  g: { name?: string; testId?: string; within?: { role?: string; name?: string } },
): ReturnType<Page['locator']> {
  const base = g.within?.role && g.within?.name
    ? page.getByRole(g.within.role as Parameters<Page['getByRole']>[0], { name: g.within.name, exact: true })
    : page;
  if (g.name) return base.getByLabel(g.name);
  if (g.testId) return base.getByTestId(g.testId);
  return base.locator('input[type="file"]');
}

/** Shared "where" schema for the grounded actuation tools. */
const GROUND = {
  role: z.string().optional().describe("ARIA role from the snapshot, e.g. 'button', 'textbox', 'link'. Pair with `name`."),
  name: z.string().optional().describe("Accessible name from the snapshot, exactly as shown. Pair with `role`."),
  testId: z.string().optional().describe('A data-testid, if the element has one and no clean role+name (e.g. an unlabeled icon button).'),
  text: z.string().optional().describe('Real visible text on the element — last resort when there is no role+name or testId.'),
  within: z.object({
    role: z.string().describe("The container's role from the snapshot, e.g. 'radiogroup' or 'group'."),
    name: z.string().describe("The container's accessible name, e.g. the group/question name."),
  }).optional().describe('Scope the search to a container first. Use when an option label repeats across groups (e.g. "No" in several Yes/No groups) or the real input is hidden — target the visible label inside the right group.'),
  dynamic: z.boolean().optional().describe("Set true when `name`/`text` is page CONTENT that varies run-to-run (a drawn word, a generated id, a date, a counter) rather than a stable UI label like 'Submit' or 'Email'. Tells Hover to anchor on something stable (testId / role / the `within` container) instead of freezing this run's literal value — so the saved test still passes next run."),
};

const NEED_TARGET = '✗ pass role+name (preferred), or testId, or text — taken from the snapshot.';

const server = new McpServer({ name: 'hover-control', version: '0.0.0' });

server.registerTool(
  'check_control',
  {
    description:
      "Select (or clear) a radio / checkbox / switch by its accessible role + name. Use this when browser_click on the control reports \"intercepts pointer events\" or times out, or otherwise leaves it unchanged — the input is a visually-hidden (sr-only) element behind a styled label, and this tool force-toggles it the way a label click would. Pass the SAME role + name you see in the snapshot (e.g. role 'radio', name 'sex male'). Omit `checked` (or pass true) to select; pass false to clear a checkbox. Crystallizes into page.getByRole(role, { name }).check().",
    inputSchema: {
      role: z.string().describe("The control's ARIA role, e.g. 'radio', 'checkbox', 'switch'."),
      name: z.string().describe("The control's accessible name exactly as shown in the snapshot, e.g. 'sex male'."),
      checked: z.boolean().optional().describe('true (default) = select/check; false = uncheck a checkbox.'),
      dynamic: z.boolean().optional().describe("Set true when `name` is content that varies run-to-run rather than a fixed label — Hover then anchors stably instead of freezing this run's literal."),
    },
  },
  async ({ role, name, checked, dynamic }) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      const locator = page.getByRole(role as Parameters<Page['getByRole']>[0], { name, exact: true });
      if (checked === false) await locator.uncheck({ force: true, timeout: 5000 });
      else await locator.check({ force: true, timeout: 5000 });
      const ok = await locator.isChecked().catch(() => null);
      noteActuation('check_control', { role, name, checked, dynamic });
      return md(`✓ ${checked === false ? 'unchecked' : 'checked'} ${role} "${name}"${ok === null ? '' : ` (isChecked=${ok})`}`);
    } catch (e) {
      return md(`✗ could not toggle ${role} "${name}": ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    } finally {
      await close();
    }
  },
);

server.registerTool(
  'click_control',
  {
    description:
      "Click an element by its accessible role + name (or testId / visible text) taken from the snapshot. This is how you click in Hover — Playwright's browser_click is disabled in this mode because its free-form element description doesn't round-trip to a replayable selector. Pass the role + name you see in browser_snapshot (e.g. role 'button', name 'Continue'). Crystallizes into page.getByRole(role, { name }).click().",
    inputSchema: { ...GROUND },
  },
  async (g) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      const loc = locate(page, g);
      if (!loc) return md(NEED_TARGET);
      await loc.click({ timeout: 5000 });
      noteActuation('click_control', g);
      return md(`✓ clicked ${describe(g)}`);
    } catch (e) {
      return md(`✗ could not click ${describe(g)}: ${errLine(e)}`);
    } finally {
      await close();
    }
  },
);

server.registerTool(
  'fill_control',
  {
    description:
      "Type a value into a text field by its accessible role + name (usually role 'textbox') taken from the snapshot, or testId / its label text. Use instead of Playwright's browser_type / browser_fill_form (disabled here). Crystallizes into page.getByRole('textbox', { name }).fill(value).",
    inputSchema: { ...GROUND, value: z.string().describe('The text to type into the field.') },
  },
  async ({ value, ...g }) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      const loc = locate(page, g);
      if (!loc) return md(NEED_TARGET);
      await loc.fill(value, { timeout: 5000 });
      noteActuation('fill_control', { ...g, value });
      return md(`✓ filled ${describe(g)} = "${value}"`);
    } catch (e) {
      return md(`✗ could not fill ${describe(g)}: ${errLine(e)}`);
    } finally {
      await close();
    }
  },
);

server.registerTool(
  'select_control',
  {
    description:
      "Choose an option in a <select> by its accessible name (role defaults to 'combobox') taken from the snapshot. Use instead of Playwright's browser_select_option (disabled here). Crystallizes into page.getByRole('combobox', { name }).selectOption(value).",
    inputSchema: { ...GROUND, value: z.string().describe('The option label or value to choose.') },
  },
  async ({ value, ...g }) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      // A <select> is role 'combobox' — default it so the agent can pass name alone.
      const loc = locate(page, { ...g, role: g.role ?? (g.name ? 'combobox' : undefined) });
      if (!loc) return md(NEED_TARGET);
      await loc.selectOption(value, { timeout: 5000 });
      noteActuation('select_control', { ...g, value });
      return md(`✓ selected "${value}" in ${describe(g)}`);
    } catch (e) {
      return md(`✗ could not select in ${describe(g)}: ${errLine(e)}`);
    } finally {
      await close();
    }
  },
);

server.registerTool(
  'upload_file',
  {
    description:
      "Upload a file to a file <input> by setting it DIRECTLY (no native file dialog is opened, so it never wedges the page). This runs in the Hover engine (you have no filesystem access yourself): pass `path` for a real file the user gave you, OR `placeholder:true` for a generated placeholder image (only after the user approved it via ask_user). Target the input by its `name` (its label/aria-label) or `testId`; if omitted, the single file input on the page is used. Crystallizes into locator.setInputFiles(...).",
    inputSchema: {
      ...GROUND,
      path: z.string().optional().describe('Path to a real file to upload (absolute, or relative to the project root).'),
      placeholder: z.boolean().optional().describe('Upload an engine-generated placeholder image instead of a real file (user-approved fallback).'),
    },
  },
  async ({ path, placeholder, ...g }) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      let absPath: string;
      if (placeholder) {
        absPath = resolve(PROJECT_ROOT, PLACEHOLDER_REL);
        await mkdir(join(PROJECT_ROOT, '__vibe_tests__', 'fixtures'), { recursive: true });
        await writeFile(absPath, PLACEHOLDER_PNG);
      } else if (path) {
        absPath = isAbsolute(path) ? path : resolve(PROJECT_ROOT, path);
      } else {
        return md('✗ pass `path` (a real file) or `placeholder:true`.');
      }
      // setInputFiles on the file <input> directly — works even when the input
      // is display:none, and (unlike clicking to open a chooser) leaves no
      // dangling file-dialog state that would poison later browser_* calls.
      await fileInput(page, g).setInputFiles(absPath, { timeout: 5000 });
      noteActuation('upload_file', { ...g, path, placeholder });
      return md(`✓ uploaded ${placeholder ? 'a placeholder image' : absPath}`);
    } catch (e) {
      return md(`✗ could not upload: ${errLine(e)}`);
    } finally {
      await close();
    }
  },
);

// ── ask_user: human-in-the-loop prompt ──────────────────────────────────────
// When the agent is genuinely stuck (missing credentials, a file it can't
// provide, an ambiguous choice), it asks the user instead of giving up. We
// reach the editor over the Hover service WS (HOVER_APPROVAL_PORT, same channel
// the source-read gate uses): send `ask-user-request`, await `ask-user-response`.
type AskAnswer = { value?: string; cancelled?: boolean };
let askWs: WebSocket | null = null;
let askSeq = 0;
const pendingAsks = new Map<string, (a: AskAnswer) => void>();

function ensureAskWs(): WebSocket | null {
  if (!APPROVAL_PORT) return null;
  if (askWs && (askWs.readyState === WebSocket.OPEN || askWs.readyState === WebSocket.CONNECTING)) return askWs;
  try {
    const sock = new WebSocket(`ws://127.0.0.1:${APPROVAL_PORT}`);
    sock.on('message', (data: Buffer) => {
      try {
        const m = JSON.parse(data.toString()) as { type?: string; payload?: { askId?: string } & AskAnswer };
        if (m?.type === 'ask-user-response' && m.payload?.askId) {
          const settle = pendingAsks.get(m.payload.askId);
          if (settle) settle({ value: m.payload.value, cancelled: m.payload.cancelled });
        }
      } catch { /* ignore malformed */ }
    });
    // Channel lost → settle every waiting ask as cancelled (the agent can't get
    // an answer, so it proceeds/reports rather than hanging). The user taking
    // their time is NOT a loss — only a closed/errored socket settles here.
    const drop = (): void => { for (const s of [...pendingAsks.values()]) s({ cancelled: true }); };
    sock.on('error', () => { drop(); });
    sock.on('close', () => { if (askWs === sock) askWs = null; drop(); });
    askWs = sock;
  } catch {
    askWs = null;
  }
  return askWs;
}

server.registerTool(
  'ask_user',
  {
    description:
      "Ask the human running the test a question and WAIT for their answer — use this instead of stopping when you are genuinely blocked: missing credentials, a file you cannot provide (e.g. a document upload), an ambiguous choice only the user can make, or a step you cannot complete on your own. Offer concrete `options` when you can (e.g. saved accounts, 'skip this step', 'stop here'); set allowFreeText so they can type their own answer. Returns the user's choice or typed text; act on it and continue. Do NOT use it for routine interactions — those go through click/fill/select_control.",
    inputSchema: {
      question: z.string().describe('The question to show the user — be specific about what you need and why.'),
      options: z.array(z.object({
        label: z.string().describe('A choice the user can pick.'),
        description: z.string().optional().describe('Optional one-line clarification of this choice.'),
      })).optional().describe('Concrete choices to offer. Omit for a free-form question.'),
      allowFreeText: z.boolean().optional().describe('Let the user type a custom answer in addition to (or instead of) the options.'),
    },
  },
  async ({ question, options, allowFreeText }) => {
    if (!APPROVAL_PORT) return md('✗ ask_user is unavailable (no editor channel). Continue from what you can do, and report what you needed.');
    const sock = ensureAskWs();
    if (!sock) return md('✗ could not reach the editor to ask. Continue and report what you needed.');
    const id = `q${++askSeq}`;
    // NO timeout: a human-in-the-loop prompt waits for the human. The user may
    // not see it for a while — that must never auto-resolve. It settles only
    // when they answer, or when the channel drops (drop() above), or when the
    // run is cancelled (which kills this process).
    const answer = await new Promise<AskAnswer>((resolve) => {
      const settle = (a: AskAnswer): void => {
        if (!pendingAsks.has(id)) return;
        pendingAsks.delete(id);
        resolve(a);
      };
      pendingAsks.set(id, settle);
      const payload = { askId: id, question, options: options ?? [], allowFreeText: allowFreeText === true };
      const req = (): void => sock.send(JSON.stringify({ type: 'ask-user-request', payload }));
      if (sock.readyState === WebSocket.OPEN) req();
      else sock.once('open', req);
    });
    if (answer.cancelled || answer.value == null || answer.value === '') {
      return md('The user dismissed the prompt without answering. Do not ask again for the same thing — continue with what you can, then report what was blocked.');
    }
    return md(`The user answered: ${answer.value}`);
  },
);

// ── record_fact: persist a learned business rule (QA / API modes) ────────────
// Fire-and-forget: send `record-fact` over the same engine channel; the engine
// writes it into .hover/memory/ (only in QA/API modes — ignored elsewhere) so
// the rule isn't re-asked next run. RULES only; never secrets/PII.
server.registerTool(
  'record_fact',
  {
    description:
      "Remember a durable BUSINESS RULE about this app so you (and future runs) never have to re-ask it — e.g. an expected behavior, a validation rule, an access policy, or a business-logic fact you confirmed (often right after the user answered an ask_user about whether something is a bug or by-design). State it as a clean, self-contained rule. RULES ONLY — never store secrets, passwords, tokens, API keys, or personal data. Use it whenever you learn something about how this app is SUPPOSED to behave; it makes Hover smarter every run.",
    inputSchema: {
      title: z.string().describe('A short title for the rule (becomes its filename + index entry).'),
      rule: z.string().describe('The rule itself, stated clearly and self-contained (no secrets/PII).'),
      type: z.enum(['business-rule', 'expected-behavior', 'validation', 'access-policy']).optional()
        .describe('What kind of knowledge this is. Defaults to business-rule.'),
    },
  },
  async ({ title, rule, type }) => {
    const sock = ensureAskWs();
    if (!sock) return md('✓ noted (memory channel unavailable; continuing).');
    const send = (): void => sock.send(JSON.stringify({ type: 'record-fact', payload: { fact: { title, rule, type } } }));
    if (sock.readyState === WebSocket.OPEN) send();
    else sock.once('open', send);
    return md(`✓ remembered: ${title}`);
  },
);

// ── take_screenshot: a VIEWPORT screenshot that never resizes the page ───────
// Why this exists instead of Playwright's browser_take_screenshot: a fullPage
// screenshot on a real (connectOverCDP, headed) browser captures the full
// document by RESIZING the window, which fires a window 'resize' event. Apps
// that re-layout on resize (responsive breakpoints, etc.) can lose transient UI
// state — e.g. a flipped flashcard snapping back — so the agent never sees the
// result of its own click and thrashes. A viewport screenshot uses
// Page.captureScreenshot of the current viewport: no resize, no side effects.
// In grounded modes the host DENIES browser_take_screenshot and routes here; the
// PNG lands in the run's shot dir so the service surfaces it in the chat exactly
// like before.
let shotSeq = 0;
server.registerTool(
  'take_screenshot',
  {
    description:
      "Take a screenshot of the CURRENT viewport to see the page as the user sees it. Use this instead of Playwright's browser_take_screenshot (disabled here): a full-page screenshot resizes the live browser window, which can reset transient page state, so Hover captures the viewport only — no resize, no side effects. To see content below the fold, scroll first, then screenshot. For finding elements to act on, rely on browser_snapshot (the accessibility tree covers the whole page, off-screen included).",
    inputSchema: {},
  },
  async () => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      const png = await page.screenshot({ timeout: 5000 }); // viewport only — never fullPage
      await mkdir(SHOT_DIR, { recursive: true });
      const file = join(SHOT_DIR, `hover-shot-${String(++shotSeq).padStart(4, '0')}.png`);
      await writeFile(file, png);
      return md('✓ screenshot captured (viewport).');
    } catch (e) {
      return md(`✗ could not take screenshot: ${errLine(e)}`);
    } finally {
      await close();
    }
  },
);

// ── assert_visible: record a verification (the invariant a flow proves) ──────
// Captured into the same candidate buffer as actuations, so it crystallizes
// inline with the flow (writeSpec translates it to an expect(...) line). We
// confirm the assertion holds NOW before recording — record==replay means we
// never save an assertion that already fails. For content that varies run-to-run
// the agent sets dynamic:true + a non-literal matcher so the spec asserts the
// invariant ("a word is shown"), not this run's value ("apple").
server.registerTool(
  'assert_visible',
  {
    description:
      "Record a VERIFICATION at the current checkpoint — the invariant a flow proves — as a Playwright assertion saved inline with the flow. Call it when a flow reaches a state worth checking (after login a greeting shows; after flipping a flashcard a word/definition is visible). Target the element by role+name / testId / text from the snapshot, exactly like the *_control tools. Pick `matcher`: 'visible' (default — the element is present), 'non-empty' (it shows SOME text), 'text-contains' (its text contains `expected`), 'text-exact' (equals `expected`), 'count' (`count` matches). CRUCIAL — if the asserted content varies run-to-run (a drawn word, a generated id, a date), set dynamic:true and use 'non-empty' or 'text-contains', NEVER 'text-exact' on the literal. Record at least one assertion per flow, before record_candidate.",
    inputSchema: {
      ...GROUND,
      matcher: z.enum(['visible', 'non-empty', 'text-contains', 'text-exact', 'count']).optional()
        .describe("What to assert. Default 'visible'."),
      expected: z.string().optional().describe("For text-contains / text-exact: the (stable) text to assert. Omit text-exact's value to use what's observed now."),
      count: z.number().optional().describe("For matcher 'count': how many matches to expect."),
    },
  },
  async ({ matcher, expected, count, ...g }) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      const loc = locate(page, g);
      if (!loc) return md(NEED_TARGET);
      const m = matcher ?? 'visible';
      const target = loc.first();
      // Confirm the assertion holds NOW — never record one that already fails.
      const visible = await target.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) return md(`✗ ${describe(g)} is not visible now — not recording an assertion that would fail on replay.`);
      const observed = (await target.textContent().catch(() => null))?.trim() || undefined;
      if (m === 'non-empty' && !observed) return md(`✗ ${describe(g)} shows no text — pick matcher 'visible' instead.`);
      noteActuation('assert_visible', { ...g, matcher: m, expected, count, observed });
      return md(`✓ asserted ${describe(g)} — ${m}${g.dynamic ? ' (dynamic → invariant)' : ''}`);
    } catch (e) {
      return md(`✗ could not assert ${describe(g)}: ${errLine(e)}`);
    } finally {
      await close();
    }
  },
);

// ── record_candidate: mark a clean flow worth crystallizing (QA mode) ────────
// You just name the flow — the engine captures the actual grounded steps you
// performed since your LAST record_candidate (or run start), so there's no
// step-number bookkeeping. Sent over the engine channel; offered to the user as
// a one-click "Crystallize" → Playwright spec.
server.registerTool(
  'record_candidate',
  {
    description:
      "Record a CANDIDATE FLOW you JUST completed — a clean, coherent end-to-end sequence worth saving as a reusable regression test (e.g. \"Log in\", \"Add item to cart\", \"Submit the registration form\"). Call this the moment you finish such a flow, BEFORE starting the next one: Hover automatically captures the successful click / fill / select / check / upload actions you did since your last record_candidate, so you only give it a name. Do NOT batch flows or call it after unrelated exploration — call it right after each distinct flow so its steps are exactly that flow's.",
    inputSchema: {
      name: z.string().describe('Short imperative flow name IN ENGLISH (becomes the spec filename + test name), e.g. "Log in" or "Add item to cart".'),
      description: z.string().optional().describe('One line on what this flow verifies.'),
    },
  },
  async ({ name, description }) => {
    // Steps since the previous marker — the flow the agent just finished.
    const steps = candidateSteps.slice(candidateMark);
    candidateMark = candidateSteps.length;
    const sock = ensureAskWs();
    if (!sock) return md('✓ noted (candidate channel unavailable; continuing).');
    const send = (): void =>
      sock.send(JSON.stringify({ type: 'record-candidate', payload: { candidate: { name, description, steps } } }));
    if (sock.readyState === WebSocket.OPEN) send();
    else sock.once('open', send);
    return md(`✓ candidate flow recorded: "${name}" (${steps.length} step${steps.length === 1 ? '' : 's'})`);
  },
);

await server.connect(new StdioServerTransport());
