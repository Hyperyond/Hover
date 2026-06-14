# Hover (`hover-dev`)

Hover's VSCode extension — the **primary surface** over Hover's agent-agnostic
engine (`@hover-dev/cli` / `@hover-dev/core`). One extension for **AI test
authoring + application-security (authz / BOLA) testing**: explore your app,
crystallize verified flows into plain `@playwright/test` specs that run in CI
with no AI. It is a thin GUI face — it never re-implements the engine.

(npm package name `hover-dev`; Marketplace id will be `hyperyond.hover-dev`.
Display name stays "Hover".)

Design: `docs/superpowers/specs/2026-06-14-security-direction-design.md` (§3.2,
why-primary) and `docs/superpowers/specs/2026-06-06-vscode-extension-design.md`
(feature ranking F1–F7).

## Status

Scaffold — native UI (no webview; matches VSCode's look):

- **Activity Bar → Hover** — a *Specs* tree listing crystallized
  `*.spec.ts` / `*.security.spec.ts` (with the stamped prompt as the row
  description; click to open). Auto-refreshes as specs change.
- **Status bar** — `✨ Hover` reflects whether a Hover dev service is reachable;
  click to focus the sidebar.

Commands & editor integrations:

- **F1** *Review Optimization Candidate* (command + editor-title button) — opens a native `vscode.diff` between
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

- **F3 (slice)** *spec-lifecycle CodeLens* — on `*.spec.ts` / `*.security.spec.ts`
  shows the stamped `Original prompt:` provenance and, when a candidate draft
  exists, a "✨ Review optimization candidate" lens (runs F1). It deliberately
  does not add a Run/Debug lens — the official Playwright extension owns that.

- **F4 (slice)** *seed authoring* — probe seeds under `.hover/rules/security/*.json`
  get JSON-schema validation + autocomplete; *Hover: New Probe Seed* scaffolds a
  template seed file. Lowers the bar to add an authz/vuln probe to a project.

Planned next (see the feature-assessment doc): F3 Re-record action, mode switch
(testing / security-orange / pentest-red in one extension).

## Develop

```bash
pnpm --filter hover-dev typecheck
pnpm --filter hover-dev build    # tsup → dist/extension.cjs (ws bundled, vscode external)
pnpm --filter hover-dev watch    # rebuild on change; Reload Window in the dev host
```

Press <kbd>F5</kbd> from this folder (uses `.vscode/launch.json`) to run an
Extension Development Host with `examples/basic-app` open.

## Install as a real extension (sideload)

```bash
pnpm --filter hover-dev build
cd packages/vscode-ext && pnpm dlx @vscode/vsce package --no-dependencies
# → hover-dev-0.0.0.vsix
```

Install the `.vsix`: VSCode **Extensions** view → **⋯** → **Install from
VSIX…** (or `code --install-extension hover-dev-0.0.0.vsix` if the `code` shell
command is installed; Cursor/Windsurf use the same VSIX). This is local
sideloading — **not** a Marketplace publish.
