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
- **F2 (editor-side half)** *Open Source from Element* — takes a
  `data-hover-source` value (`<rel-path>:<line>:<col>`, stamped by
  `@hover-dev/transform-source`) and jumps the editor to that location. The
  page→editor transport (a click in the running app surfacing the attribute) is
  the follow-on; today the command accepts the value directly or prompts.

Planned next (see the feature-assessment doc): F2 page→editor transport,
F3 spec-lifecycle CodeLens, F4 seed-library authoring.

## Develop

```bash
pnpm --filter @hover-dev/vscode-ext typecheck
pnpm --filter @hover-dev/vscode-ext build   # tsup → dist/extension.cjs (vscode external)
```
