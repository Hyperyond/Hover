# Plugin options

Common config surface across all Hover bundler integrations.

```ts
interface HoverOptions {
  /**
   * Whether to spawn an isolated debug Chrome on dev-server boot.
   * Default: `false`. The widget will guide the user to launch one on
   * first ✨ click if disabled, so leaving this `false` is safe.
   * Examples in the monorepo set this to `true` for one-step `pnpm smoke`.
   */
  autoLaunchChrome?: boolean;

  /**
   * Port the Hover service binds to. Default: `51789`. Auto-bumps to
   * 51790, 51791, ... 51798 if the requested port is busy. The injected
   * widget reads `window.__HOVER_PORT__` so each example's widget
   * connects only to its own service.
   */
  port?: number;

  /**
   * Override the CDP URL the agent connects to. Default:
   * `http://localhost:9222` (the standard `--remote-debugging-port=9222`).
   * Rarely needed.
   */
  chromeDebugPort?: number;
}
```

::: info This page is a placeholder
Full content coming soon — per-bundler shim specifics (Vite's `apply: 'serve'`, Next's `withHover` wrapper + instrumentation hook, Webpack's `HtmlWebpackPlugin` integration), plus the environment-variable overrides (`HOVER_AGENT`, `HOVER_MODEL`, `HOVER_CDP`).
:::
