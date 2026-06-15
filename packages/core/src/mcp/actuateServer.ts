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

const CDP_URL = process.env.HOVER_CDP_URL || 'http://localhost:9222';
const DEV_URL = process.env.HOVER_DEV_URL || '';

function md(text: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text }] };
}

function originOf(u: string): string | null {
  try { return new URL(u).origin; } catch { return null; }
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
      const locator = page.getByRole(role as Parameters<Page['getByRole']>[0], { name });
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

await server.connect(new StdioServerTransport());
