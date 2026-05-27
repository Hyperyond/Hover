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

Read `packages/security/src/index.ts` end-to-end — it exercises every field above except `widgetEventTypes` enforcement. It's ~140 lines.
