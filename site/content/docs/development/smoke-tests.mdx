# Smoke tests

Hover ships three test layers. Use them as a release gate.

## Unit — Vitest, per package

```bash
pnpm test                              # fan out across the workspace
pnpm --filter @hover-dev/core test     # one package only
```

Tests live in `packages/*/tests/`. Keep `src/` source-only — do not put `*.test.ts` inside `src/`.

## Integration / end-to-end — Playwright

Crystallized specs under `examples/basic-app/__vibe_tests__/` run as standard `@playwright/test`. No agent in the loop — only the saved script:

```bash
pnpm --filter basic-app exec playwright install chromium   # first-time setup
pnpm test:e2e
```

## Smoke-level (agent in the loop)

Requires a running debug Chrome (`pnpm smoke:chrome`) and an example dev server. Not part of CI.

```bash
pnpm smoke                                                     # default
pnpm smoke http://localhost:5173/ "log in, add a todo"         # custom target + prompt
HOVER_AGENT=codex pnpm smoke                                   # switch agent for this run
```

## Plugin smokes

Optional plugins have their own smokes. `@hover-dev/security` ships six:

```bash
pnpm --filter @hover-dev/security smoke           # mitm primitives (no Chrome)
pnpm --filter @hover-dev/security smoke:e2e       # real Chrome over CDP + SPKI + HTTP/2 mutation
pnpm tsx packages/security/scripts/plugin-smoke.ts        # WS mode toggle lifecycle
pnpm tsx packages/security/scripts/mcp-smoke.ts           # MCP client drives all 4 tools
pnpm tsx packages/security/scripts/agent-config-smoke.ts  # mcp-config includes plugin entry
pnpm tsx packages/security/scripts/widget-ws-smoke.ts     # widget wire protocol surface
```

## Validation strategy

Before marking work ready:

1. `pnpm typecheck` — fans out to every package.
2. `pnpm test` — Vitest, fans out across packages with tests.
3. `pnpm build` — confirms every package's `tsc -p tsconfig.build.json` is clean.
4. The package-scoped smoke or Playwright run that matches the files changed.

That sequence is also what the publish workflow gates a release on.
