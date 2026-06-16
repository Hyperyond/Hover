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
import { getPreflight } from './preflightCache.js';

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

  const cdp = await getPreflight(cdpUrl);
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
