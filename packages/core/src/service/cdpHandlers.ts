/**
 * CDP-related WebSocket message handlers.
 *
 *   launch-chrome → emit "launching" placeholder → launchDebugChrome →
 *                   re-check status → emit cdp-status
 *
 * Extracted from service.ts during the v0.2.x refactor pass so the main
 * file can be a thin orchestrator.
 */

import type { WebSocket } from 'ws';
import { checkCdpStatus } from '../playwright/cdpStatus.js';
import { launchDebugChrome, type LaunchOptions } from '../playwright/launchChrome.js';
import { send, type ClientMessage } from './types.js';

/** Extra launch options surfaced from the active mode (security plugin
 *  needs a resident proxy + spki). When none are set, behaviour is identical
 *  to pre-v0.7 normal-mode launch. */
export type LaunchExtras = Pick<LaunchOptions, 'proxy' | 'userDataDir'>;

/**
 * Launch a debug Chrome navigated to `pageUrl`, then re-check status. The
 * re-check usually returns 'wrong-window' (because the widget asking is in
 * the user's regular Chrome, not the freshly-launched one) — the widget then
 * displays the "use the other window" state.
 */
export async function handleLaunchChrome(
  ws: WebSocket,
  msg: ClientMessage,
  cdpUrl: string,
  extras?: LaunchExtras,
): Promise<void> {
  const pageUrl = msg.payload?.pageUrl;
  if (typeof pageUrl !== 'string' || !pageUrl) {
    send(ws, { type: 'error', payload: { message: 'launch-chrome: pageUrl is required' } });
    return;
  }
  // Tell the widget we're launching so it can render a spinner immediately —
  // findChromeBinary + spawn + ready-poll can take a few seconds.
  send(ws, { type: 'cdp-status', payload: { state: 'no-cdp', launching: true } });

  const port = (() => {
    try {
      return Number(new URL(cdpUrl).port) || 9222;
    } catch {
      return 9222;
    }
  })();
  const result = await launchDebugChrome({
    url: pageUrl,
    port,
    proxy: extras?.proxy,
    userDataDir: extras?.userDataDir,
    headless: msg.payload?.headless === true,
    force: msg.payload?.force === true,
  });
  if (!result.ok) {
    send(ws, { type: 'cdp-status', payload: { state: 'no-cdp', reason: result.reason } });
    return;
  }
  const status = await checkCdpStatus(cdpUrl, pageUrl);
  send(ws, { type: 'cdp-status', payload: status });
}
