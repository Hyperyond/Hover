/**
 * "Is the widget running in the debug Chrome?" — answered by comparing the
 * widget's page origin against the CDP tab list.
 *
 * Three states:
 *   - 'same-window'   widget IS in the debug Chrome; agent can drive this tab.
 *   - 'wrong-window'  debug Chrome is up, but on a different Chrome process.
 *                     Widget should disable itself; service can bringToFront
 *                     the corresponding tab in the debug Chrome so the user
 *                     can switch windows.
 *   - 'no-cdp'        no debug Chrome at all; the widget should let the user
 *                     trigger a launch.
 */
import { chromium } from 'playwright-core';
import { preflightCDP } from './preflight.js';
import { findCdpPid, raiseChromeWindow } from './raiseWindow.js';

export type CdpState = 'same-window' | 'wrong-window' | 'no-cdp';

export interface CdpStatusResult {
  state: CdpState;
  /** Tab count when state !== 'no-cdp'. */
  tabCount?: number;
  /** Matching tab URL inside the debug Chrome (only set for 'wrong-window'). */
  matchingTabUrl?: string;
  /** Browser product string from /json/version when state !== 'no-cdp'. */
  browser?: string;
  /** When state === 'no-cdp', the preflight reason. */
  reason?: string;
}

/**
 * Parse a page URL down to its origin (protocol + host + port). We compare
 * by origin, not full URL — the user might be on /login while the debug
 * Chrome tab is on /, but they're the same SPA, same app, same target.
 */
function originOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export async function checkCdpStatus(
  cdpUrl: string,
  pageUrl: string,
): Promise<CdpStatusResult> {
  const wantOrigin = originOf(pageUrl);
  if (!wantOrigin) {
    // Treat unparseable page URLs as no-cdp so the UI nudges a relaunch.
    return { state: 'no-cdp', reason: `unparseable page URL: ${pageUrl}` };
  }

  const cdp = await preflightCDP(cdpUrl);
  if (!cdp.ok) {
    return { state: 'no-cdp', reason: cdp.reason };
  }

  const match = cdp.tabs.find(t => originOf(t.url) === wantOrigin);

  if (match) {
    return {
      state: 'same-window',
      tabCount: cdp.tabs.length,
      browser: cdp.browser,
      matchingTabUrl: match.url,
    };
  }

  return {
    state: 'wrong-window',
    tabCount: cdp.tabs.length,
    browser: cdp.browser,
  };
}

/**
 * Bring the debug-Chrome tab matching `pageUrl`'s origin to the front. If no
 * matching tab exists, open a new tab on the origin. Returns the URL of the
 * tab that was focused (or opened) for logging.
 *
 * Uses a short-lived playwright-core connection — opens it, does the work,
 * closes it. We don't keep a long-lived browser handle.
 */
export async function focusDebugTab(
  cdpUrl: string,
  pageUrl: string,
): Promise<{ ok: true; focusedUrl: string } | { ok: false; reason: string }> {
  const wantOrigin = originOf(pageUrl);
  if (!wantOrigin) {
    return { ok: false, reason: `unparseable page URL: ${pageUrl}` };
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `couldn't connect to CDP at ${cdpUrl}: ${msg}` };
  }

  let focusedUrl: string;
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    const match = pages.find(p => originOf(p.url()) === wantOrigin);
    if (match) {
      await match.bringToFront();
      focusedUrl = match.url();
    } else {
      // No tab on the dev origin yet — open one so the widget appears.
      const context = browser.contexts()[0] ?? (await browser.newContext());
      const page = await context.newPage();
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      focusedUrl = page.url();
    }
  } catch (err) {
    await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `bringToFront failed: ${msg}` };
  }
  await browser.close().catch(() => {});

  // CDP-level bringToFront only activates the tab inside the Chrome process;
  // on macOS in particular the Chrome *window* stays buried if it wasn't
  // foreground already. Raise the OS window too. Best-effort, never fatal.
  const port = portFromCdpUrl(cdpUrl);
  if (port !== null) {
    const pid = await findCdpPid(port);
    if (pid !== null) await raiseChromeWindow(pid);
  }

  return { ok: true, focusedUrl };
}

function portFromCdpUrl(cdpUrl: string): number | null {
  try {
    const u = new URL(cdpUrl);
    const port = Number.parseInt(u.port, 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}
