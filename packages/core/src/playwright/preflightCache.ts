import { preflightCDP } from './preflight.js';

/**
 * Per-cdpUrl preflight cache.
 *
 * Why this exists: Hover preflights the CDP endpoint (`/json/version` +
 * `/json/list`) before every agent command AND on every widget connect's
 * `check-cdp` ping. Each `/json/list` round-trip is ~30–80 ms on local
 * Chrome; doing it twice for the same request — once from the command
 * path, once from the widget's CDP banner — adds up, and the widget pings
 * frequently because Vite HMR cycles the WebSocket connection.
 *
 * The cache is shared across both paths and keyed by `cdpUrl` so multiple
 * Hover services (one per example app in this monorepo, each with its own
 * CDP endpoint someday) don't share entries. 30 s TTL — Chrome's tab list
 * doesn't drift faster than that during a dev session, and any failure
 * (Chrome killed, --remote-debugging-port closed) invalidates via
 * `invalidatePreflight()` on the next failed agent invocation.
 *
 * Successful preflights are cached; failures are not (so the user gets
 * immediate feedback the next time they fix the underlying issue —
 * starting Chrome, fixing the wrong port).
 */
type Result = Awaited<ReturnType<typeof preflightCDP>>;
const TTL_MS = 30_000;

interface Entry { result: Result; at: number }
const cache = new Map<string, Entry>();

export async function getPreflight(cdpUrl: string): Promise<Result> {
  const now = Date.now();
  const hit = cache.get(cdpUrl);
  if (hit && hit.result.ok && now - hit.at < TTL_MS) {
    return hit.result;
  }
  const result = await preflightCDP(cdpUrl);
  if (result.ok) {
    cache.set(cdpUrl, { result, at: now });
  } else {
    cache.delete(cdpUrl);
  }
  return result;
}

export function invalidatePreflight(cdpUrl: string): void {
  cache.delete(cdpUrl);
}
