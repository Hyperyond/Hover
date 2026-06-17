# Changelog — Hover (`hover-dev`)

All notable changes to the **Hover** VS Code extension. Dates are ISO 8601 (UTC).
The repository changelog (with the `@hover-dev/*` engine packages) lives at the repo root.

## 0.17.0 — 2026-06-17

**The chat stream, redesigned.** The run view is now a clean linear "thread" — like Claude Code — instead of collapsible step boxes.

- **Linear thread.** Each AI decision is a node on a continuous left rail; the browser actions it triggers hang off the same rail as one-line, plain-language steps (`Clicked "Sign in"`, `Filled email → …`, `Navigated to /checkout`) — typed out live, with real per-step time + token meta — instead of raw multi-line MCP JSON. No folding, no boxes.
- **Result + findings merged** into one plain block (✓ outcome, summary, inline findings, dim meta footer) — no cards.
- **After-run save prompt.** The "Save as spec" button is gone; when a run finishes Hover asks — in the composer's place — whether to save and for a filename, warning when the agent flagged issues. Aligned to, and mutually exclusive with, the input.
- **Copy buttons** on the Done summary and each finding (✓ on success).
- `ask_user` answers render as a concise threaded node (`You answered: …`).
- Tidier agent output: shorter interim narration and a single JSON final report (less noise, fewer tokens).

## 0.16.0 — 2026-06-17

**Now on the VS Code Marketplace.**

- The orange mode is renamed **API testing** — one mode now covers both functional/contract API testing and security/authz testing (access control, IDOR/BOLA); confirmed findings crystallize to `.api-test.spec.ts`.
- **Structured findings** rendered as cards; a **Network view** (live MITM flows) in API-testing / Pentest modes; **Specs folded into the Dashboard**.
- Removed the model-API-key field — coding agents authenticate via their own logged-in subscription.

## 0.15.0 — 2026-06-07

- **Structured spec output** — Page Objects, named `test.step` stages, and `Promise.all`-paired popup / upload / download flows.
- Terminal **CLI mode** for authoring a spec without the webview.

## 0.14.x — 2026-05-31

- First VS Code extension builds: a chat webview drives your real Chrome and crystallizes verified flows into plain `@playwright/test` specs. Native **Specs / Sessions / Environments** views, the `@account` credential vault, **Add CI Workflow**, and an optional AI optimize pass. The engine ships inside the extension — no bundler plugin to install.
