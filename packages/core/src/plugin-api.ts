/**
 * Hover plugin API — the public contract third-party packages target.
 *
 * Plugins are *mostly declarative*: they ship a manifest describing what
 * resources they contribute (a mode, MCP servers, Chrome flags, agent
 * prompt fragments, widget event schemas). For genuinely time-bound work
 * — booting a sidecar like mockttp when a mode activates, tearing it down
 * when the mode deactivates or the service shuts down — they register
 * namespaced lifecycle hooks.
 *
 * Patterned after Astro Integrations (declarative manifest + namespaced
 * hooks: `astro:config:setup` etc). The `apiVersion` literal lets us
 * evolve the manifest and reject mismatched plugins at load time with a
 * clear error rather than silent breakage.
 *
 * Stability:
 *   - `apiVersion: 1` is what this file declares; breaking changes bump.
 *   - Adding new optional fields or new hook names is non-breaking.
 *   - Plugin authors should import only from this module; deep imports
 *     into `@hover-dev/core` internals are not part of the contract.
 */

/**
 * The Hover plugin API version this build of @hover-dev/core understands.
 * Plugins declare which version they target via their manifest; mismatches
 * are rejected at load time.
 */
export type HoverApiVersion = 1;
export const CURRENT_API_VERSION: HoverApiVersion = 1;

// ──────────────────────────────────────────────────────────────────────
// Manifest pieces
// ──────────────────────────────────────────────────────────────────────

export interface HoverPluginMode {
  /** Globally unique id (across all loaded plugins). Lowercase kebab. */
  id: string;
  /** Human-readable label shown in the widget mode-picker. */
  label: string;
  /** One-liner help text shown in the dropdown. */
  description?: string;
  /** Mode ids this mode cannot be active alongside. Two plugins both
   *  needing an exclusive proxy would set each other here. */
  conflictsWith?: string[];
}

export interface HoverPluginMcpServer {
  /** Stable, namespaced id (`@hover-dev/security:flows`). Host enforces
   *  uniqueness across all loaded plugins. */
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Modes in which this MCP is exposed to the agent. Default: only the
   *  plugin's own mode. Use `['*']` to mean "always on". */
  activeInModes?: string[];
}

export interface HoverPluginChromeFlags {
  /** Extra args appended to the Chrome launch argv. */
  args?: string[];
  /** Custom user-data-dir for this mode. Strongly recommended when proxy
   *  is set, so the secured profile doesn't share cookies with normal mode. */
  userDataDir?: string;
  /** Custom CDP port for this mode. Strongly recommended for the same
   *  reason — keeps the two modes' Chromes addressable independently. */
  cdpPort?: number;
  /** When present, Chrome is launched with --proxy-server + the
   *  --ignore-certificate-errors-spki-list pin so the proxy's MITM CA is
   *  accepted without polluting the OS trust store. */
  proxy?: { port: number; spki: string };
  /** Modes in which these flags apply. Default: only the plugin's own mode. */
  activeInModes?: string[];
}

export interface HoverPluginSystemPromptAddition {
  text: string;
  /** Modes in which this paragraph is included in the agent's system
   *  prompt. Default: only the plugin's own mode. */
  activeInModes?: string[];
}

// ──────────────────────────────────────────────────────────────────────
// Hooks
// ──────────────────────────────────────────────────────────────────────

export interface HoverBroadcast {
  /** Push a JSON event to every WebSocket-connected widget. Event `type`
   *  should be namespaced by the plugin (`security:flow:added`). */
  (event: { type: string; payload?: unknown }): void;
}

export interface HoverHookCtxBase {
  /** Absolute path of the user's project root (Vite's `server.config.root`,
   *  Astro's project dir, etc.). Use this for persisting CA material, not
   *  process.cwd(). */
  devRoot: string;
  /** Push a custom event to every connected widget. */
  broadcast: HoverBroadcast;
}

/** Fired when this plugin's mode becomes active. The plugin may boot
 *  sidecars (mockttp, profilers, …) here and return any settings that
 *  affect downstream subsystems (Chrome relaunch, MCP server env vars). */
export interface ModeActivateCtx extends HoverHookCtxBase {
  modeId: string;
  /** Tell the host "Chrome should be relaunched with these proxy settings"
   *  for the duration of this mode. Pass null to clear. */
  setChromeProxy(proxy: { port: number; spki: string } | null): void;
  /** Set additional env vars on one of this plugin's declared MCP servers.
   *  The MCP server isn't actually spawned until the agent runs a command,
   *  so plugins use this in activate() to pass runtime data (port numbers,
   *  auth tokens) that didn't exist at manifest-construction time.
   *  Merged on top of any env declared in the manifest; subsequent calls
   *  for the same id replace previous overrides. */
  setMcpServerEnv(id: string, env: Record<string, string>): void;
}

/** Fired when this plugin's mode is being deactivated. The plugin
 *  MUST stop any sidecar it started in activate. */
export interface ModeDeactivateCtx extends HoverHookCtxBase {
  modeId: string;
}

/** Fired exactly once when the host service is shutting down for any
 *  reason. Hooks must release subprocesses and file handles. */
export type ShutdownCtx = HoverHookCtxBase;

export interface HoverHooks {
  'hover:mode:activate'?: (ctx: ModeActivateCtx) => void | Promise<void>;
  'hover:mode:deactivate'?: (ctx: ModeDeactivateCtx) => void | Promise<void>;
  'hover:service:shutdown'?: (ctx: ShutdownCtx) => void | Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────
// Manifest
// ──────────────────────────────────────────────────────────────────────

export interface HoverPluginManifest {
  /** Always 1 in this build. Future versions may add 2, 3, … */
  apiVersion: HoverApiVersion;

  /** Globally unique plugin name. Use the npm package name. */
  name: string;

  /** Optional widget mode contributed by this plugin. */
  mode?: HoverPluginMode;

  /** Extra MCP servers exposed to the agent in the indicated modes. */
  mcpServers?: HoverPluginMcpServer[];

  /** Chrome launch overrides for the indicated modes. */
  chromeFlags?: HoverPluginChromeFlags;

  /** System-prompt paragraphs concatenated into the agent's prompt in
   *  the indicated modes. */
  systemPromptAdditions?: HoverPluginSystemPromptAddition[];

  /** Names of custom event types this plugin broadcasts. Documented
   *  here so the widget side can be tree-shaken to skip handlers for
   *  events that no loaded plugin will ever produce. */
  widgetEventTypes?: string[];

  hooks?: HoverHooks;
}

// ──────────────────────────────────────────────────────────────────────
// Author helper
// ──────────────────────────────────────────────────────────────────────

/**
 * Branded factory that wraps a plugin manifest factory. The wrapper
 * - asserts `apiVersion` matches this core's version at construction time
 *   (catches authors who copy-pasted from a tutorial for a different core),
 * - returns a `(opts) => manifest` so call sites read `securityMode()` /
 *   `perfMode({ sampleHz: 100 })` uniformly.
 *
 * Use:
 *
 *   export default defineHoverPlugin<MyOpts>((opts) => ({
 *     apiVersion: 1,
 *     name: '@hover-dev/security',
 *     mode: { id: 'security', label: 'Security testing' },
 *     ...
 *   }));
 */
export function defineHoverPlugin<TOpts = void>(
  factory: (opts: TOpts) => HoverPluginManifest,
): (opts: TOpts) => HoverPluginManifest {
  return (opts: TOpts) => {
    const manifest = factory(opts);
    if (manifest.apiVersion !== CURRENT_API_VERSION) {
      throw new Error(
        `[hover] plugin "${manifest.name}" targets apiVersion ` +
          `${String(manifest.apiVersion)} but this Hover supports ` +
          `${CURRENT_API_VERSION}. Update either the plugin or @hover-dev/core.`,
      );
    }
    return manifest;
  };
}
