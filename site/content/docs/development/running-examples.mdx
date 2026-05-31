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

## Manual-validation example: `turbo-monorepo`

`examples/turbo-monorepo/` is a minimal turbo + pnpm-workspace monorepo with two Next.js 15 apps (`apps/web`, `apps/game`). It exists to reproduce the shape real users have when they run `npx @hover-dev/cli add` on a turbo project — and to surface bugs that hide in the single-package examples above. Not part of `pnpm dev:example:*` because the install step requires real-network npm to bring in `next` / `react`. Validate by hand from the example's own root:

```bash
cd examples/turbo-monorepo
npx @hover-dev/cli@latest add                 # interactive picker (apps/web vs apps/game)
npx @hover-dev/cli@latest add --cwd apps/web  # or skip the picker
pnpm install                                   # bring in the per-app next/react deps
pnpm dev                                       # turbo run dev — apps/web on :5183
```

See [`examples/turbo-monorepo/README.md`](https://github.com/Hyperyond/Hover/tree/main/examples/turbo-monorepo) for the specific install-path edge cases this example was built to verify.

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
