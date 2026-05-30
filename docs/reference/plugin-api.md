# Plugin API

Hover's plugin API lets third-party packages contribute **modes** that show up in the widget's mode picker — each mode can register an extra MCP server, supply its own Chrome launch flags, append paragraphs to the agent's system prompt, and broadcast custom events to the widget.

`@hover-dev/security` is the first plugin built on this API. The shape below is everything you need to write your own.

## Importing

```ts
import { defineHoverPlugin, type HoverPluginManifest } from '@hover-dev/core/plugin-api';
```

## Minimal plugin

```ts
// packages/my-plugin/src/index.ts
import { defineHoverPlugin } from '@hover-dev/core/plugin-api';

export default defineHoverPlugin<{ verbose?: boolean }>((opts) => ({
  apiVersion: 1,
  name: '@example/hover-perf',

  mode: {
    id: 'perf',
    label: 'Performance probing',
    description: 'Capture Core Web Vitals and flag layout shifts.',
  },

  systemPromptAdditions: [
    {
      text: 'Performance mode is active. Use mcp__playwright__browser_evaluate to capture LCP / CLS and report anomalies as Findings.',
    },
  ],

  hooks: {
    async 'hover:mode:activate'(ctx) {
      // Boot any sidecar (a profiler, a metrics server) here.
      if (opts?.verbose) ctx.broadcast({ type: 'perf:started' });
    },
    async 'hover:mode:deactivate'() {
      // Tear it down.
    },
  },
}));
```

User wires it into their bundler config:

```ts
import { hover } from 'vite-plugin-hover';
import perfMode from '@example/hover-perf';

export default defineConfig({
  plugins: [hover({}, perfMode({ verbose: true }))],
});
```

## Manifest

```ts
interface HoverPluginManifest {
  apiVersion: 1;                                  // literal, bumped on breaking changes
  name: string;                                   // unique, use the npm package name

  mode?: HoverPluginMode;                         // contribute a widget mode
  mcpServers?: HoverPluginMcpServer[];            // extra MCPs exposed to the agent
  chromeFlags?: HoverPluginChromeFlags;           // launch overrides
  systemPromptAdditions?: HoverPluginSystemPromptAddition[];
  widgetEventTypes?: string[];                    // namespaces of events you'll broadcast
  widgetEntry?: string;                           // absolute path to plugin widget JS module (v0.9+)
  saveHandlers?: HoverPluginSaveHandler[];
  hooks?: HoverHooks;
}
```

### mode

```ts
interface HoverPluginMode {
  id: string;                                     // globally unique, lowercase kebab
  label: string;                                  // shown in the picker
  description?: string;                           // shown in picker rows + tooltip
  conflictsWith?: string[];                       // other mode ids this can't coexist with
}
```

When set, the widget shows a mode bar above the panel header. Selecting this mode fires the `hover:mode:activate` hook below.

### mcpServers

```ts
interface HoverPluginMcpServer {
  id: string;                                     // namespaced, e.g. '@you/foo:bar'
  command: string;                                // absolute path or PATH-resolvable bin
  args?: string[];
  env?: Record<string, string>;                   // merged with runtime overrides
  activeInModes?: string[];                       // default: this plugin's own mode; '*' = always
}
```

Each entry becomes a key under the agent's MCP config when the matching mode is active. Claude exposes tools as `mcp__<sanitised id>__<tool>` (non-alphanumerics → underscore).

Runtime env that doesn't exist at manifest-construction time (a sidecar port, an auth token) goes through `ctx.setMcpServerEnv(id, env)` inside the activate hook — see [hooks](#hooks) below.

### chromeFlags

```ts
interface HoverPluginChromeFlags {
  args?: string[];                                // appended to Chrome argv
  userDataDir?: string;                           // recommended when proxy is set
  cdpPort?: number;                               // recommended for the same reason
  proxy?: { port: number; spki: string };         // wired automatically by setChromeProxy()
  activeInModes?: string[];                       // default: this plugin's own mode
}
```

`proxy` is the load-bearing field for MITM-style plugins. When set, Hover launches Chrome with `--proxy-server=127.0.0.1:<port>` and `--ignore-certificate-errors-spki-list=<spki>`, so the proxy's CA validates without touching the OS trust store.

### systemPromptAdditions

```ts
interface HoverPluginSystemPromptAddition {
  text: string;                                   // paragraph appended to the agent's prompt
  activeInModes?: string[];                       // default: this plugin's own mode; '*' = always
}
```

Concatenated onto the agent's system prompt for every command issued while a matching mode is active. Keep paragraphs short — every plugin adds prompt tokens. The active-mode prompt addition is currently uncapped, but a per-plugin token budget will land in a future release.

### widgetEventTypes

```ts
widgetEventTypes?: string[];                      // e.g. ['security:flow:added', 'security:flow:updated']
```

Documents the event types this plugin broadcasts. Today this is informational — the widget side accepts unknown event types but knows nothing about them. Future iterations will use this for tree-shaking the widget bundle.

### widgetEntry (v0.9+)

```ts
widgetEntry?: string;                             // absolute path to a JS module
```

Resolves to an absolute path on disk pointing at a JS module that runs **inside the widget's Shadow DOM**. The host reads this file at bundle-assembly time, inlines it as a `<script type="module">` after the widget core, and the module looks up `window.__HOVER_WIDGET__` (set by `packages/widget-bootstrap/src/widget/host.js`) to contribute its UI.

Plugin authors typically resolve the absolute path inside the server-side entry, e.g.:

```ts
import { fileURLToPath } from 'node:url';

const widgetEntry = fileURLToPath(new URL('./widget.js', import.meta.url));
```

If absent, the plugin contributes no widget code (server-side-only plugin).

### saveHandlers (v0.12+)

```ts
saveHandlers?: HoverPluginSaveHandler[];
```

Registers plugin-owned Save-dropdown entries. The widget broadcasts a `type`-keyed WS message when the user picks an entry; the matching server-side handler writes a file under the user's project and returns its path. Each `HoverPluginSaveHandler` has:

- `type: string` — WS message type the widget will send. Convention: `save:<plugin>:<kind>` (e.g. `save:security:spec`).
- `label: string` — human-readable label shown in the UI (also used in confirmation toasts).
- `description?: string` — optional longer description for the dropdown row.
- `activeInModes?: string[]` — modes in which this entry is offered. Defaults to the plugin's own mode.
- `handle({ devRoot, payload })` → `Promise<{ path, slug }>` — async writer. Receives the user's project root and the widget-supplied payload (form field values); resolves with the absolute `path` of the written file and the `slug` used to name it.

## Widget host API (v0.9+)

Plugin widget modules see one global: `window.__HOVER_WIDGET__`. Its surface is:

```ts
interface WidgetHost {
  apiVersion: 1;
  registerPlugin(spec: WidgetPluginSpec): void;
  getState(): Record<string, unknown>;           // union of every plugin's namespaced state
  setState(patch: Record<string, unknown>): void; // merged into the active plugin's slot
  openOverlay(overlayId: string): void;          // namespaced id, e.g. '@hover-dev/security:network'
  closeOverlay(overlayId: string): void;
  send(msg: object): void;                       // push a message to the service over WS
}
```

`getState()` returns the full union (`{ [pluginName]: { ... } }`); plugins are expected to read only their own entry. `setState(patch)` merges into the namespace of whichever plugin owns the currently-active mode — there's no need to repeat your name in every call. Calling `setState` while no plugin mode is active is a silent no-op.

### WidgetPluginSpec

```ts
interface WidgetPluginSpec {
  apiVersion: 1;
  name: string;                                   // matches the server-side manifest name
  modeId: string;                                 // matches the server-side mode.id

  css?: string;                                   // auto-namespaced — every selector becomes
                                                  //   `[data-plugin-active="<name>"] <selector>`

  domMutations?: {                                // applied on activate, reverted on deactivate
    hide?: string[];                              //   set .hidden = true on each match
    addClass?: Record<string, string>;            //   { selector: className }
  };

  toolbarButtons?: Array<{
    id: string;
    tooltip?: string;
    icon?: string;                                // inline-SVG string or unicode
    onClick?: (api: WidgetHost) => void;
    badge?: (api: WidgetHost) => string | number | null;
  }>;

  overlays?: Array<{
    id: string;                                   // namespace it — '@you/plugin:panel'
    title?: string;
    actions?: Array<{
      icon?: string;
      tooltip?: string;
      onClick?: (api: WidgetHost) => void;
    }>;
    render?: (container: HTMLElement, state: Record<string, unknown>) => void;
  }>;

  saveEntries?: SaveEntrySpec[];

  onMessage?: Record<string, (payload: unknown, api: WidgetHost) => void>;
  onActivate?: (api: WidgetHost) => void;
  onDeactivate?: (api: WidgetHost) => void;
}
```

### saveEntries (widget, v0.12+)

```ts
saveEntries?: SaveEntrySpec[];
```

Adds plugin-owned entries to the widget's Save dropdown. Each `SaveEntrySpec` (see `packages/widget-bootstrap/src/widget/host.js`):

- `type: string` — must match a server-side `HoverPluginSaveHandler.type` (e.g. `save:security:spec`).
- `label: string` — dropdown row label.
- `sub?: string` — optional sub-label / hint shown beneath the label.
- `icon?: string` — optional inline-SVG string or unicode glyph.
- `title?: string` — heading shown in the save dialog. Defaults to `label`.
- `fields?: FieldSpec[]` — input fields rendered in the dialog. Defaults to a single name field. Each field: `{ id, label, placeholder?, required? }`.
- `confirmLabel?: string` — button label. Defaults to `"Save"`.
- `successMsgTemplate?: string` — toast template. Defaults to `'✓ saved "{name}" → {path}'`; `{name}` and `{path}` are substituted from the field values and the server-side response.

### `domMutations` is for plugin-owned DOM

`hide` / `addClass` look like they could target any element — but they're intended for the plugin's own contributions (toolbar buttons, overlay bodies, etc.). The default-mode widget core (Record, Fix, Send, footer, overlays, the mode bar itself) is **not** a target. Core owns its own visibility — it listens for `modes` payload changes and applies `applyDefaultModeVisibility` to its own widgets internally.

The host doesn't enforce this — pointing `hide` at `.record-btn` technically works — but it produces a two-sided coupling where the plugin tracks core selector names and core could refactor at any time. The `@hover-dev/security` widget module explicitly declares "no domMutations targeting core widget elements" in its source code; new plugins should follow the same discipline.

### Single-mode exclusivity

At most one plugin's contributions are visible at any moment. Server-side `currentModeId: string | null` is the source of truth; the widget host's `applyMode(newModeId)` deactivates the prior owner (revert DOM mutations, remove overlays, remove toolbar buttons, remove `<style>`, call `onDeactivate`) before activating the new one (inject namespaced CSS, append toolbar buttons + overlays, apply `domMutations`, call `onActivate`). When `newModeId === null`, the widget looks identical to a build with no plugins — that's the symmetric "default mode" state.

### Symmetric mode ownership

Default mode (Record / Fix / Send / etc.) and plugin modes share a symmetric protocol: each side owns its own widgets and listens for `modes` payload changes to show/hide them itself. Plugins **never** need to know default mode's selectors; default mode never knows about any specific plugin. Adding a new plugin no longer requires listing "what core buttons should I hide."

### Failure mode

Every plugin-supplied callback runs inside a try/catch inside the host. A plugin crashing in `registerPlugin` / `onMessage` / `overlay.render` / `onActivate` / `onDeactivate` produces a structured `[hover/plugin "<name>"] <where> failed: <msg>` console error, but never blocks the WS pump or other plugins.

### Reference: `packages/security/src/widget.js`

The 224-line `packages/security/src/widget.js` is the canonical example. It registers `@hover-dev/security` against `modeId: 'security'`, contributes ~120 lines of namespaced CSS, one toolbar button (`network`), one overlay (`@hover-dev/security:network`), one `saveEntries` entry (`Security spec` in the Save dropdown, triggers writing `__vibe_tests__/<slug>.security.spec.ts`), and two WS message handlers (`security:flow:added` / `security:flow:updated`). `onDeactivate` drops the captured flow list so re-entering security mode starts with a clean slate.

## Hooks

Namespaced (Astro-style). Adding a new hook name is non-breaking; renaming an existing one bumps the apiVersion.

```ts
interface HoverHooks {
  'hover:mode:activate'?:    (ctx: ModeActivateCtx)    => void | Promise<void>;
  'hover:mode:deactivate'?:  (ctx: ModeDeactivateCtx)  => void | Promise<void>;
  'hover:service:shutdown'?: (ctx: ShutdownCtx)        => void | Promise<void>;
}
```

### ctx (passed to every hook)

```ts
interface HoverHookCtxBase {
  devRoot: string;                                // user's project root (Vite's server.config.root)
  broadcast(event: { type: string; payload?: unknown }): void;
}
```

`devRoot` is where you should persist any plugin-local state (CA material, captured snapshots). The repo's root `.gitignore` already ignores `.hover/` so a hidden directory under there is safe.

`broadcast` pushes a JSON event to every connected widget. Namespace your event types (`<plugin>:<kind>`).

### ModeActivateCtx extras

```ts
interface ModeActivateCtx extends HoverHookCtxBase {
  modeId: string;
  setChromeProxy(proxy: { port: number; spki: string } | null): void;
  setMcpServerEnv(id: string, env: Record<string, string>): void;
}
```

Use `setChromeProxy(...)` to tell the host that the secured Chrome needs proxy + SPKI flags for the duration of this mode.

Use `setMcpServerEnv(...)` to publish runtime data into a declared MCP server's env. `@hover-dev/security` for example boots its control plane in `hover:mode:activate` and writes the chosen port + auth token through this so the spawned MCP subprocess can talk to it without out-of-band coordination.

## Conflict resolution

Hover refuses to start if it detects:

- Two plugins with the same `name`
- Two plugins contributing the same `mode.id`
- A plugin manifest with the wrong `apiVersion`

Mode `conflictsWith` is currently informational; runtime enforcement lands in a future release.

## Reference implementation

Read `packages/security/src/index.ts` end-to-end (~335 lines) — it exercises the manifest, mode, MCP server, Chrome flags, system prompt additions, hooks, `widgetEntry` resolution, and `saveHandlers` (Security spec output via `writeSecuritySpec`).

For the widget side of the same plugin, `packages/security/src/widget.js` (~225 lines) is the canonical example — see the [Widget host API](#widget-host-api-v0-9) section above.
