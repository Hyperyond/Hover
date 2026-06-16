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
  const match = wantOrigin ? pages.find((p) => originOf(p.url()) === wantOrigin) : undefined;
  return { page: match ?? pages[0], close };
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
  if (g.text) return base.getByText(g.text);
  return null;
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
    },
  },
  async ({ role, name, checked }) => {
    const picked = await pickPage();
    if (!picked) return md(`✗ could not reach the page over CDP (${CDP_URL}).`);
    const { page, close } = picked;
    try {
      const locator = page.getByRole(role as Parameters<Page['getByRole']>[0], { name, exact: true });
      if (checked === false) await locator.uncheck({ force: true, timeout: 5000 });
      else await locator.check({ force: true, timeout: 5000 });
      const ok = await locator.isChecked().catch(() => null);
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
      "Upload a file to a file-input / upload control (located by role+name from the snapshot, or testId/text). This runs in the Hover engine (you have no filesystem access yourself): pass `path` to upload a real file the user gave you, OR `placeholder:true` to upload a generated placeholder image (use this only after the user approved it via ask_user). Crystallizes into a Playwright filechooser + setFiles step.",
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
      const loc = locate(page, g);
      if (!loc) return md(NEED_TARGET);
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
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        loc.click({ timeout: 5000 }),
      ]);
      await chooser.setFiles(absPath);
      return md(`✓ uploaded ${placeholder ? 'a placeholder image' : absPath} via ${describe(g)}`);
    } catch (e) {
      return md(`✗ could not upload via ${describe(g)}: ${errLine(e)}`);
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

await server.connect(new StdioServerTransport());
