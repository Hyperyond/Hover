# turbo-monorepo example

A minimal **turbo + pnpm-workspace** monorepo with two Next.js 15 apps. Exists to verify the v0.7.3 / v0.7.4 install paths against the shape real users have:

- Root `package.json` only declares turbo + workspaces — no bundler.
- `apps/web` — Next.js 15 + `next.config.ts`. The combination that surfaced `ERR_PACKAGE_PATH_NOT_EXPORTED` (Next 15 loads `.ts` configs through CJS `require()`).
- `apps/game` — second Next workspace, intentionally NOT wired to Hover. Exists so running `npx @hover-dev/cli setup` at the repo root triggers the interactive multi-workspace picker.

This example is dogfood for the CLI. It is not configured to "just run" out-of-the-box because Hover dispatches into a *user's choice* of workspace — the wiring lives in `apps/web/` and `apps/game/` stays bare.

## Shape verified by this example

1. **CLI monorepo dispatch** (v0.7.3) — running the CLI at the root finds both `apps/web` and `apps/game`, shows the interactive picker in a TTY, installs only into the picked workspace.
2. **CLI workspace lockfile inheritance** (v0.7.3) — `apps/web` has no local `pnpm-lock.yaml`; the CLI walks up to the monorepo root and uses its lockfile to pick pnpm.
3. **Next 15 + `next.config.ts` loads cleanly** (v0.7.3) — `@hover-dev/next` ships dual ESM + CJS so the CJS require step doesn't trip on missing `exports.require`.
4. **`instrumentation.ts` resolves `register-node` from `.next/server/`** (v0.7.4) — Next inlines the file into its build output, breaking relative paths. The fix uses a package-subpath specifier (`@hover-dev/next/internal/register-node`) that routes through node_modules.
5. **`turbo run dev` from the root works** — Next reads `apps/web/instrumentation.ts` (NOT the monorepo root), the Hover service boots, the widget injects into pages served on port 5183.
6. **Plugin specifiers resolve from `apps/web/` in a monorepo** — `apps/web/instrumentation.ts` calls `registerHover({}, ['@hover-dev/security'])`. The resolver in `@hover-dev/next/internal/register-node` walks up from `process.cwd()` (which is `apps/web/` under `pnpm --filter web dev` / `turbo run dev`) and finds the workspace-linked plugin under `apps/web/node_modules/`. Service log on boot confirms `plugins=[@hover-dev/security]`.

## Local validation steps

From the repo root (the Hover monorepo, not this example):

```bash
# Build the publishable packages so the workspace `@hover-dev/next` is consumable
pnpm --filter @hover-dev/next --filter @hover-dev/core --filter @hover-dev/widget-bootstrap build

# Verify the CLI's monorepo logic against this example
node packages/cli/dist/index.js add --dry-run                    # asks for --cwd
node packages/cli/dist/index.js add --cwd apps/web --dry-run     # picks web

# Real run is interactive (picker) — easiest done by hand in a terminal
cd examples/turbo-monorepo && npx @hover-dev/cli@latest add
```

## What this example is NOT

- **Not** in the workspace's `pnpm test` / `pnpm typecheck` fan-out — it deliberately contains zero `.ts` files that need typechecking under the empty `tsconfig.json` shape, and the install steps need real-network npm to bring in `next` / `react`. The validation flow above is manual.
- **Not** a template for production turbo monorepos. Real turbo setups carry shared packages, `eslint-config-*`, `tsconfig` packages, CI graph. This example strips all of that to surface exactly the workspace-detection edge cases the CLI cares about.

Apps run on ports 5183 (web) and 5184 (game) to stay clear of the other examples (5173–5182).
