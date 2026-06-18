# Changelog — Hover (`hover-dev`)

All notable changes to the **Hover** VS Code extension. Dates are ISO 8601 (UTC).
The repository changelog (with the `@hover-dev/*` engine packages) lives at the repo root.

## 0.18.1 — 2026-06-18

- **Fix:** in API-testing / Pentest mode the agent's API tools (`api_request`, `replay_flow`, …) were blocked under Claude — now allowed, so the agent calls your endpoints directly instead of falling back to the docs UI.
- **Fix:** Save now routes by the run's mode — switching modes after a run no longer mis-saves it.
- **Fix:** an API-test save / record covers just that run, not the whole session.
- The ask / save popup width matches the input box, and the mode-colour running border is removed.

## 0.18.0 — 2026-06-18

**API testing is request-first.** The 🟠 API-testing mode now tests endpoints by issuing requests directly, and the saved spec is pure API — never UI clicks.

- **`api_request` tool** — the agent calls endpoints directly. For an API-only backend (or one with only interactive docs like Swagger / Scalar / Redoc) it no longer drives the docs UI to send requests. Origin-locked to the app under test, and it auto-carries the browser's logged-in session cookie.
- **Saved spec is a pure `request.*` `.api-test.spec.ts`** — UI-independent. Saving in API-testing mode routes to the request-writer (not the browser-step writer); every assertion comes from a recorded check.
- **Full API traffic is recorded** to `.hover/cache/api/<session>.json`, bound to the session (local + git-ignored).
- **Pentest** mode likewise: the agent chooses to drive the UI or call the API directly.
- **Cleaner chat** — read-only / navigation steps (snapshots, screenshots, scroll) are hidden from the stream; the `ask_user` free-text answer is an inline row (pencil + input + send); narration stays in your language throughout.
- **Save is a button** on the Done block (mode-aware: API spec / findings report / spec), instead of an auto-popup.
- The Activity Bar panel is renamed **Hover Testing**.

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
