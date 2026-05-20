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
