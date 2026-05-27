# Running examples

Each example app under `examples/*` is both a smoke target and a real app you can interact with via the widget. Run any of them after `pnpm install`:

```bash
pnpm dev:example:basic-app           # http://localhost:5173 — login + counter + todos
pnpm dev:example:e-commerce          # http://localhost:5174 — Amazon-style storefront
pnpm dev:example:stock-registration  # http://localhost:5175 — brokerage account form
pnpm dev:example:canvas-paint        # http://localhost:5176 — canvas + DOM toolbar
pnpm dev:example:payment-provider    # http://localhost:5177 — third-party popup target
pnpm dev:example:astro-app           # http://localhost:5178 — Astro 5
pnpm dev:example:nuxt-app            # http://localhost:5179 — Nuxt 4
pnpm dev:example:webpack-app         # http://localhost:5180 — vanilla webpack 5
pnpm dev:example:rn-web-app          # http://localhost:5181 — React Native Web
pnpm dev:example:next-app            # http://localhost:5182 — Next 16 App Router
```

Each example sets `autoLaunchChrome: true` so a debug Chrome opens on `:9222` pointed at the dev URL on first run. The profile dir under `<tmpdir>/hover-chrome` reuses session state across runs.

## Auxiliary commands

```bash
pnpm smoke:chrome     # launch debug Chrome without an example dev server
pnpm smoke            # end-to-end: detect agents → CDP preflight → invoke claude
pnpm detect           # list installed coding-agent CLIs
pnpm verify-widget    # confirm the widget bundle reports data-hover="true"
pnpm ws-smoke         # exercise the @hover-dev/core WebSocket bridge in isolation
pnpm bench-ttfb       # time the LLM-driven loop's first tool_use latency
```

## Multiple examples at once

Each example's bundler shim starts its own Hover service. The first to boot binds `127.0.0.1:51789`; subsequent ones auto-bump (`:51790`, `:51791`, …, up to `:51798`). The injected widget reads `window.__HOVER_PORT__` so each example's widget connects only to its own service.

Running e-commerce + payment-provider together is supported; the e-commerce example's *Pay with PayHover* popup opens the payment-provider tab on `:5177`. Payment-provider has no Hover widget by design — it simulates a third-party origin.

## Common environment overrides

```bash
HOVER_AGENT=codex pnpm dev:example:basic-app  # default to codex instead of claude
HOVER_MODEL=opus  pnpm smoke                  # one-off opus run (default is sonnet)
HOVER_CDP=http://localhost:9333 pnpm smoke    # different debug Chrome
```
