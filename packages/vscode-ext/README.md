# @hover-dev/vscode-ext

Hover's VSCode extension — the **primary surface** over Hover's agent-agnostic
engine (`@hover-dev/cli` / `@hover-dev/core`). It is a thin GUI face: it never
re-implements the engine, and every artifact it helps author stays plain
`@playwright/test`.

Design: `docs/superpowers/specs/2026-06-14-security-direction-design.md` (§3.2,
why-primary) and `docs/superpowers/specs/2026-06-06-vscode-extension-design.md`
(feature ranking F1–F7).

## Status

Scaffold. Two commands so far:

- **F1** *Review Optimization Candidate* — opens a native `vscode.diff` between
  the active spec and its candidate at
  `<workspaceRoot>/.hover/cache/optimized/<spec>.draft`. Invoke from the editor
  title bar on a `*.spec.ts` file or via the palette.
- **F2** *element → source* — Alt+click any host element in the in-page widget
  and the editor jumps to its `data-hover-source` location
  (`<rel-path>:<line>:<col>`, stamped by `@hover-dev/transform-source`). The
  transport reuses the core WebSocket: the widget sends `reveal-source`, the
  service relays it, and this extension's WS client (`serviceClient.ts`, ports
  51789–51798) opens the file via `hover.openSource`. The command also accepts a
  value directly / prompts. End-to-end needs a running example + the extension
  loaded in a VSCode dev host (manual smoke).

Planned next (see the feature-assessment doc): F3 spec-lifecycle CodeLens,
F4 seed-library authoring.

## Develop

```bash
pnpm --filter @hover-dev/vscode-ext typecheck
pnpm --filter @hover-dev/vscode-ext build   # tsup → dist/extension.cjs (vscode external)
```
