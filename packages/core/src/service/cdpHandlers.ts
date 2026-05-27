/**
 * CDP-related WebSocket message handlers.
 *
 *   check-cdp     → checkCdpStatus → emit cdp-status
 *   launch-chrome → emit "launching" placeholder → launchDebugChrome →
 *                   re-check status → emit cdp-status
 *   focus-debug   → focusDebugTab → no message on success (the widget the
 *                   user is about to focus runs its own check-cdp anyway)
 *
 * Extracted from service.ts during the v0.2.x refactor pass so the main
 * file can be a thin orchestrator.
 */

import type { WebSocket } from 'ws';
import { checkCdpStatus, focusDebugTab } from '../playwright/cdpStatus.js';
import { launchDebugChrome, type LaunchOptions } from '../playwright/launchChrome.js';
import { send, type ClientMessage } from './types.js';

/** Extra launch options surfaced from the active mode (security plugin
 *  needs proxy + spki + separate profile + non-default CDP port). When
 *  none are set, behaviour is identical to pre-v0.7 normal-mode launch. */
export type LaunchExtras = Pick<LaunchOptions, 'userDataDir' | 'proxy'> & {
  /** Override CDP port (mode-specific, e.g. 9333 for security). When set,
   *  this also wins over the `port` parsed from cdpUrl. */
  cdpPort?: number;
};

/**
 * "Is this widget running inside the debug Chrome?" The widget asks this on
 * connect (and after every status-changing event) so it can render itself as
 * either:
 *   - same-window  → normal, drives the page
 *   - wrong-window → disabled, with a "use the other window" notice
 *   - no-cdp       → enabled but click triggers launch-chrome instead
 */
export async function handleCheckCdp(
  ws: WebSocket,
  msg: ClientMessage,
  cdpUrl: string,
  extras?: LaunchExtras,
): Promise<void> {
  const pageUrl = msg.payload?.pageUrl;
  if (typeof pageUrl !== 'string' || !pageUrl) {
    send(ws, { type: 'error', payload: { message: 'check-cdp: pageUrl is required' } });
    return;
  }
  const effectiveCdpUrl = extras?.cdpPort
    ? `http://localhost:${extras.cdpPort}`
    : cdpUrl;
  const status = await checkCdpStatus(effectiveCdpUrl, pageUrl);
  send(ws, { type: 'cdp-status', payload: status });
}

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

  const port = extras?.cdpPort ?? (() => {
    try {
      return Number(new URL(cdpUrl).port) || 9222;
    } catch {
      return 9222;
    }
  })();
  const result = await launchDebugChrome({
    url: pageUrl,
    port,
    userDataDir: extras?.userDataDir,
    proxy: extras?.proxy,
  });
  if (!result.ok) {
    send(ws, { type: 'cdp-status', payload: { state: 'no-cdp', reason: result.reason } });
    return;
  }
  // Re-check status against the port we actually launched on, so a mode-
  // specific port (9333 for security) doesn't get probed at 9222.
  const effectiveCdpUrl = extras?.cdpPort
    ? `http://localhost:${extras.cdpPort}`
    : cdpUrl;
  const status = await checkCdpStatus(effectiveCdpUrl, pageUrl);
  send(ws, { type: 'cdp-status', payload: status });
}

/**
 * bringToFront the debug-Chrome tab matching `pageUrl`'s origin (or open one
 * if none exists). Used by the wrong-window UI's "switch to debug Chrome"
 * button. Doesn't return cdp-status — bringToFront doesn't change anything
 * the widget cares about, and the widget the user is about to focus is a
 * different page (and will run its own check-cdp on its own ws connection).
 */
export async function handleFocusDebug(
  ws: WebSocket,
  msg: ClientMessage,
  cdpUrl: string,
  extras?: LaunchExtras,
): Promise<void> {
  const pageUrl = msg.payload?.pageUrl;
  if (typeof pageUrl !== 'string' || !pageUrl) {
    send(ws, { type: 'error', payload: { message: 'focus-debug: pageUrl is required' } });
    return;
  }
  const effectiveCdpUrl = extras?.cdpPort
    ? `http://localhost:${extras.cdpPort}`
    : cdpUrl;
  const result = await focusDebugTab(effectiveCdpUrl, pageUrl);
  if (!result.ok) {
    send(ws, { type: 'error', payload: { message: `focus-debug: ${result.reason}` } });
  }
}
