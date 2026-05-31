import { chromium } from 'playwright-core';

/**
 * Connect to the user's Chrome via CDP and return the URLs of all open tabs.
 * Closes the connection before returning (does not hold a Playwright session).
 */
export async function connectAndListTabs(cdpUrl: string): Promise<string[]> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(c => c.pages());
    return pages.map(p => p.url());
  } finally {
    await browser.close();
  }
}

export interface CdpTabInfo {
  url: string;
  title?: string;
  type?: string;
}

export type CdpPreflightResult =
  | { ok: true; browser: string; tabs: CdpTabInfo[] }
  | { ok: false; reason: string };

/**
 * Lightweight CDP health check via the /json endpoints.
 *
 * Critical: this MUST run before invoking the agent. If CDP isn't responsive,
 * the Playwright MCP server falls back to launching its OWN Chromium — and
 * Hover's premise is to drive the user's existing Chrome (with their dev
 * state, cookies, devtools open), never spawn a fresh one.
 *
 * Pure HTTP — no playwright-core handshake, no setDownloadBehavior nonsense
 * that can get stuck on busy CDP sessions.
 */
export async function preflightCDP(
  cdpUrl: string,
  timeoutMs = 2000,
): Promise<CdpPreflightResult> {
  let versionRes: Response;
  try {
    versionRes = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Chrome debug session not detected at ${cdpUrl}. Click the ✨ launcher in the widget to start it, or run \`pnpm exec hover-chrome\` (npx hover-chrome).`,
    };
  }
  if (!versionRes.ok) {
    return { ok: false, reason: `CDP returned HTTP ${versionRes.status}` };
  }

  let versionJson: { Browser?: string };
  try {
    versionJson = (await versionRes.json()) as { Browser?: string };
  } catch {
    return { ok: false, reason: 'CDP /json/version returned non-JSON' };
  }

  let tabs: CdpTabInfo[] = [];
  try {
    const listRes = await fetch(`${cdpUrl}/json/list`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (listRes.ok) {
      const raw = (await listRes.json()) as { url?: string; title?: string; type?: string }[];
      tabs = raw
        .filter(t => t.type === 'page' || !t.type)
        .map(t => ({ url: t.url ?? '', title: t.title, type: t.type }))
        .filter(t => t.url.length > 0);
    } else {
      // /json/version was healthy but /json/list wasn't — surface it so the
      // agent's system prompt isn't silently built from an empty tab list.
      console.warn(`[hover] CDP /json/list returned HTTP ${listRes.status}; agent tab hint will be empty`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[hover] CDP /json/list failed: ${msg}; agent tab hint will be empty`);
  }

  return {
    ok: true,
    browser: versionJson.Browser ?? 'unknown',
    tabs,
  };
}
