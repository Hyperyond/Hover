# Changelog — Hover (`hover-dev`)

All notable changes to the **Hover** VS Code extension. Dates are ISO 8601 (UTC).
The repository changelog (with the `@hover-dev/*` engine packages) lives at the repo root.

## 0.20.39 — 2026-06-20

**Multi-turn chat fix + internal cleanup.**

- **Fixed:** on a 2nd or later turn in a conversation, a clarification (the agent asking you to choose) could be mis-rendered as a "Done" result card with a Save prompt, because step counting spanned the whole conversation instead of the current run. Step counting is now scoped per-run.
- **Internal:** the chat thread is now derived from a single source of truth by one builder (the live stream and a reloaded conversation share the exact same rendering path), removing a class of live-vs-reload drift.

## 0.20.38 — 2026-06-20

**You decide what to save · clearer chat · stable reports · api-test control plane fixed.**

- **No more auto-save — you decide.** A finished run no longer writes a spec on its own. The Done card ends with a one-liner ("This run took N steps · M tok. Want to **Save** this spec?") and a small inline Save button. Runs that took no real actions show no save prompt at all.
- **One run → one file.** Dropped the per-feature / per-flow auto-split; a run crystallizes to a single spec. Re-running the same prompt overwrites the same file.
- **Inline screenshot previews.** Screenshots the agent takes show as thumbnails in the chat (click to open a lightbox); the originals are kept under `.hover/screenshots/<session>/`. One screenshot per view.
- **Clearer message stream.** Action verbs (Clicked / Filled / Selected / Checked) are bold, "Upload file" shows the file path, repeated narration is de-duplicated, and the live working indicator was polished.
- **Clickable clarifications.** When the agent needs you to choose, it now renders the options as buttons — click one to answer and resume the run — instead of ending its turn with a plain question. Clarifications are kept distinct from a run's Done summary.
- **Stable report format.** The agent's final report is now markdown-first (outcome sentence + bullets + an optional Findings list) instead of a fragile JSON blob, so results render reliably.
- **Memory setting.** Settings → Memory lets you pick whether the test agent shares your Claude Code project memory ("Same as Claude Code", default) or runs in an isolated context. Fixes a case where the test agent loaded the developer's project memory.
- **api-test / pentest control plane fixed.** The MITM proxy now boots under the bundled engine (pinned `get-port` to its last CJS release, `5.1.1`, to avoid `ERR_REQUIRE_ESM` on VS Code's Node), so api-test runs actually observe API traffic.

## 0.20.0 — 2026-06-18

**Auto-saved, feature-split specs + full light/dark theming.**

- **Auto-save.** When a run finishes with results it crystallizes automatically — no Save click. The name comes from your prompt; re-running a flow overwrites the same file. Turn off with `hover.autoSaveSpec`.
- **Specs split by feature/module.** API-testing runs split by API resource (`auth.api-test.spec.ts`, `admin.api-test.spec.ts`); frontend runs split by feature when the agent marks flows (`login.spec.ts`, `checkout.spec.ts`) — small, single-purpose files instead of one monolith.
- **API save never comes up empty.** If the agent verified endpoints by browsing (or a docs UI) instead of the direct request tool, the saved spec is now derived from the captured API traffic instead of failing with "no checks recorded".
- **Follows your VS Code theme.** Every Hover panel (chat, Settings, Dashboard, Conversations, Network) now adapts to the active light / dark / high-contrast theme, with the mint accent retuned for light. Fixed hover/focus states that showed as dark blocks on light themes.
- **Tidier, tighter chat.** Repeated source-exploration steps fold into one expandable line; the mode tint is confined to the input area; the input / messages / header sit tight to the panel edges (centered with a max-width only on very wide panels, like Claude Code). Removed the "New session" dropdown caret.
- **Clearer Local / Cloud tabs.** The Conversations tab switcher has an elevated selected-pill state that's legible in both themes, and switching tabs no longer shifts the layout width.

## 0.19.2 — 2026-06-18

- **Narrow-panel polish.** When the chat panel is dragged narrow, the toolbar's labelled buttons (browser / mode) and the app-status collapse to icon-only (tooltips kept); the model name truncates with an ellipsis instead of overflowing the panel edge. The composer also sits a little tighter to the panel edges.

## 0.19.1 — 2026-06-18

- **Redesigned the chat's empty state.** An ambient-glow sparkle with a gradient "Hover" wordmark, a refined tagline, and three example-prompt chips (click one to prefill the composer), with a staggered entrance and gentle idle motion (breathing glow, float, shimmer). Respects the OS "reduce motion" setting.

## 0.19.0 — 2026-06-18

**Model settings: Local CLI ↔ BYOK.** The Settings panel now has two tabs for where runs get their model.

- **Local CLI** — your detected coding-agent CLIs render as selectable cards (Claude Code / Codex / Gemini / Local LLM), with a "Recommended" / "⚠ Soft sandbox" badge, an inline endpoint for the Local LLM, an **Installable** list with one-click-copy install commands, and a **Rescan** button.
- **BYOK (bring your own key)** — pick a protocol (Anthropic / OpenAI / Azure OpenAI / Google Gemini) or an OpenAI-compatible gateway (Ollama Cloud / SenseAudio / AIHubMix), then supply an API key + base URL + model. Hover injects these into the protocol's matching CLI at run time (so that CLI still needs to be installed). The API key is stored in VS Code SecretStorage, per protocol — never in settings or the spec.

## 0.18.2 — 2026-06-18

- **Fix:** the chat stream and the `ask_user` prompt now render the agent's Markdown (`**bold**`, `` `code` ``) instead of showing the raw `**` / `` ` `` characters — narration, question, options, and the answer line all parse it.

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
