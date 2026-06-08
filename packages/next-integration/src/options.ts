/**
 * Hover Next.js integration options.
 *
 * These are accepted by both `withHover()` (the `next.config.ts` wrapper)
 * and `register()` (the `instrumentation.ts` helper). The wrapper serialises
 * them into env vars so the instrumentation hook can read them at runtime.
 *
 * Why env vars: `withHover` runs at config-evaluation time, but the actual
 * service must boot inside `instrumentation.ts`'s `register()` hook so Next
 * can guarantee dev-only execution (instrumentation does not fire during
 * `next build`). Env vars are the only side-effect-free channel that crosses
 * that boundary.
 */
export interface HoverOptions {
  /** Port for the local Hover WebSocket service (default 51789). Auto-bumps
   *  up to 9 times if busy. */
  port?: number;
  /** Whether the integration is active. Defaults to
   *  `process.env.NODE_ENV === 'development'`. */
  enabled?: boolean;
  /** Chrome CDP debug port the agent will operate on (default 9222). */
  chromeDebugPort?: number;
  /** Auto-launch a debug Chrome pointed at the dev server when Next starts.
   *  Default false — the widget detects on first click whether it's running
   *  in the debug Chrome and launches one if not. Idempotent: reuses an
   *  existing debug Chrome if `chromeDebugPort` is already alive. */
  autoLaunchChrome?: boolean;
  /** URL Chrome opens to when `autoLaunchChrome` is on. Defaults to
   *  `http://localhost:3000/`. Set if your Next dev server lives elsewhere. */
  devUrl?: string;
  /** Agent id from @hover-dev/core's registry (default 'claude'). */
  agentId?: string;
  /** Model passed to the agent (default 'sonnet'). */
  model?: string;
  /** Hard $ ceiling per command. No default. */
  maxBudgetUsd?: number;
  /** Stamp `data-hover-source="<file>:<line>:<col>"` on host JSX elements
   *  in user code so the widget's Fix picker can produce a precise file
   *  location. Wired via Turbopack's `turbopack.rules` (or webpack's
   *  module rules if you run `next dev --webpack`). Default true.
   *  No-op outside development. */
  sourceAttribution?: boolean;
}

/** Env var keys the config wrapper writes and the runtime helpers read.
 *  Namespaced `__HOVER_NEXT_*` to avoid colliding with anything Next-stable. */
export const ENV_KEYS = {
  PORT: '__HOVER_NEXT_PORT',
  ENABLED: '__HOVER_NEXT_ENABLED',
  CHROME_DEBUG_PORT: '__HOVER_NEXT_CHROME_DEBUG_PORT',
  AUTO_LAUNCH_CHROME: '__HOVER_NEXT_AUTO_LAUNCH_CHROME',
  DEV_URL: '__HOVER_NEXT_DEV_URL',
  AGENT_ID: '__HOVER_NEXT_AGENT_ID',
  MODEL: '__HOVER_NEXT_MODEL',
  MAX_BUDGET_USD: '__HOVER_NEXT_MAX_BUDGET_USD',
  /** Set by the running service so `<HoverScript />` knows which port to
   *  emit. The auto-bump in `@hover-dev/core/service` may shift the actual
   *  port up from the requested one — the wrapper can't predict it, so the
   *  service publishes its final port here on boot. */
  RESOLVED_PORT: '__HOVER_NEXT_RESOLVED_PORT',
  /** JSON-serialised plugin descriptors `[{ name, modeId, widgetEntry }]`
   *  written by `registerNode()` after it has resolved the plugin module
   *  specifiers. `<HoverScript />` reads this at RSC render time to know
   *  which plugin widget bundles to inline. Only carries strings — no
   *  closures, no hooks — so it's safe across the env-var boundary.
   *  Empty array (or unset) → widget core only, no plugin contributions. */
  RESOLVED_PLUGINS: '__HOVER_NEXT_RESOLVED_PLUGINS',
} as const;

/** Read HoverOptions back out of `process.env`, as written by `withHover`.
 *  Used by `register()` to recover the user's config inside the
 *  instrumentation hook. */
// "Unset env var" vs "explicit false" matters for `enabled`/`autoLaunchChrome`:
// downstream `?? defaultValue` only applies the default when the value is
// undefined, so we must return undefined (not false) for keys the user never
// wrote. `writeOptionsToEnv` writes '1' or '0' for set values; anything else
// (unset, empty string) maps back to undefined.
function readBool(raw: string | undefined): boolean | undefined {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return undefined;
}

function readNumber(raw: string | undefined): number | undefined {
  // A present-but-non-numeric value (`Number('abc')` -> NaN) must not poison
  // the downstream `?? default` fallback, since `NaN ?? x` is still `NaN`.
  // Map anything non-finite back to undefined so the default applies.
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function readOptionsFromEnv(): HoverOptions {
  const env = process.env;
  return {
    port: readNumber(env[ENV_KEYS.PORT]),
    enabled: readBool(env[ENV_KEYS.ENABLED]),
    chromeDebugPort: readNumber(env[ENV_KEYS.CHROME_DEBUG_PORT]),
    autoLaunchChrome: readBool(env[ENV_KEYS.AUTO_LAUNCH_CHROME]),
    devUrl: env[ENV_KEYS.DEV_URL] || undefined,
    agentId: env[ENV_KEYS.AGENT_ID] || undefined,
    model: env[ENV_KEYS.MODEL] || undefined,
    maxBudgetUsd: readNumber(env[ENV_KEYS.MAX_BUDGET_USD]),
  };
}

/** Write HoverOptions to `process.env`. Pure: only sets keys whose values
 *  were actually provided, so a downstream `register()` falling back on
 *  its own defaults still works for unset fields. */
export function writeOptionsToEnv(opts: HoverOptions): void {
  const env = process.env;
  if (opts.port !== undefined) env[ENV_KEYS.PORT] = String(opts.port);
  if (opts.enabled !== undefined) env[ENV_KEYS.ENABLED] = opts.enabled ? '1' : '0';
  if (opts.chromeDebugPort !== undefined) env[ENV_KEYS.CHROME_DEBUG_PORT] = String(opts.chromeDebugPort);
  if (opts.autoLaunchChrome !== undefined) env[ENV_KEYS.AUTO_LAUNCH_CHROME] = opts.autoLaunchChrome ? '1' : '0';
  if (opts.devUrl !== undefined) env[ENV_KEYS.DEV_URL] = opts.devUrl;
  if (opts.agentId !== undefined) env[ENV_KEYS.AGENT_ID] = opts.agentId;
  if (opts.model !== undefined) env[ENV_KEYS.MODEL] = opts.model;
  if (opts.maxBudgetUsd !== undefined) env[ENV_KEYS.MAX_BUDGET_USD] = String(opts.maxBudgetUsd);
}
