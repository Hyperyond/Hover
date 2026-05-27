# Plugin options

Common config surface across all Hover bundler integrations.

```ts
interface HoverOptions {
  /**
   * Pre-warm Hover's **isolated debug Chrome** at dev-server boot.
   *
   * This does NOT launch your everyday Chrome. It spawns a separate,
   * temp-profile Chrome on `--remote-debugging-port=9222` with a clean
   * user-data-dir under `<tmpdir>/hover-chrome`. No cookies, extensions,
   * or signed-in accounts are shared with your normal browser session.
   * That's the whole point — the agent drives THIS Chrome, your
   * everyday tabs stay untouched.
   *
   * - `false` (default): nothing happens at `pnpm dev` time. The first
   *   time you click the ✨ widget, it'll prompt you and spawn the
   *   debug Chrome on demand. Safe and zero-cost when you're not
   *   ready to use Hover yet.
   *
   * - `true`: spawn the debug Chrome immediately when your dev server
   *   starts. Useful for `pnpm smoke` style flows where you want the
   *   browser open and navigated to your dev URL with no extra clicks.
   *
   * Idempotent — if a debug Chrome is already running on port 9222
   * (e.g. from a previous `pnpm dev` whose Chrome you didn't close),
   * Hover reuses it instead of spawning a second.
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

## About the debug Chrome (FAQ)

**It's not your normal Chrome.** Hover deliberately operates an isolated profile so the agent's clicks and navigation can't touch your everyday browsing — different cookies, different sessions, no risk of an automation script logging into your real bank tab. The profile dir is `<tmpdir>/hover-chrome` and is reused across runs (your login state inside Hover's Chrome persists, but it's a separate "you").

**Why a separate Chrome and not "remote-debug your existing one"?** Attaching to your everyday Chrome would require relaunching it with `--remote-debugging-port`, which would (a) close your current tabs and (b) expose every cookie / session / extension to whatever the agent does. The trade-off Hover makes: one extra login in the debug Chrome, but your real browser stays untouched.

**Where does the debug Chrome live after my dev server exits?** Because it's spawned `detached + unref`'d, Chrome keeps running after `next dev` / `vite dev` exits. Next `pnpm dev` reuses it (`autoLaunchChrome: true` becomes a no-op, the existing window navigates to the new dev URL). To force a clean Chrome, close it manually or `lsof -i :9222 -t | xargs kill`.

**I don't want auto-launch.** Leave `autoLaunchChrome: false` (the default). First ✨ click prompts you and spawns Chrome on demand. Or start it yourself anytime: `pnpm exec hover-chrome` / `npx hover-chrome`.

## Environment-variable overrides

```bash
HOVER_AGENT=codex  pnpm dev     # default agent claude → codex
HOVER_MODEL=opus   pnpm dev     # default model sonnet → opus (~5× cost)
HOVER_CDP=http://localhost:9333 pnpm dev   # different debug Chrome
```

Per-invocation only. The plugin options above are the persistent source of truth.
