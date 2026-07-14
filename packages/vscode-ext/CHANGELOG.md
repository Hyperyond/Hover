# Changelog — Hover (`hover-dev`)

All notable changes to the **Hover** VS Code extension. Dates are ISO 8601 (UTC).
The repository changelog (with the `@hover-dev/*` engine packages) lives at the repo root.

## 0.45.0 — 2026-07-11

- **Visual baselines are generated + reviewed in CI.** Because screenshot baselines are platform-specific (a macOS baseline won't match CI's Linux), the generated workflow now creates them in CI's Linux env: the run uses `--update-snapshots=missing` (write a missing baseline, pixel-compare an existing one, never overwrite), and new baselines open a review PR — so you confirm the captured look is right before it becomes the source of truth. Same-repo only; sharded runs seed baselines but skip the auto-PR.

## 0.44.0 — 2026-07-11

- **Multi-type testing.** Alongside E2E + API, Hover now crystallizes **Visual** (screenshot baselines) and **Accessibility** (axe-core) specs — all deterministic, no AI at run time. The generated CI workflow installs `@axe-core/playwright` when `a11y/` specs exist. The Business Map graph and Mermaid export mark each type at a glance: E2E rounded, API 🛡 hexagon, Visual 🖼 parallelogram, a11y ♿ box. Specs are laid out under `__vibe_tests__/{e2e,visual,api,a11y}/`.

## 0.42.0 — 2026-07-10

- **Cloud-stored account passwords are now shown + usable.** An account whose password lives in Hover Cloud shows ☁🔑 on its card, and the Agent (MCP) target reads "credentials available from Hover Cloud" — the agent pulls them at run time, so no local `.env` export is needed to log in. (Pairs with the Cloud fix that writes dashboard-configured passwords into the readable encrypted store.)

## 0.41.0 — 2026-07-10

- **Fix: Cloud-managed test accounts now show on the environment card.** Importing a Cloud environment copied its name + URL but not its accounts (those are Cloud metadata), so an environment like `production` listed no accounts. The panel now reconciles Cloud accounts onto the matching environment on every refresh (silent + idempotent), so each shows on its card with a set-password / export action.

## 0.40.0 — 2026-07-10

- **Opt-in account sync to Hover Cloud.** After setting a test-account password, the editor offers "Sync to Cloud" — encrypted at rest server-side (AES-256-GCM), so the MCP can log in as that account on any signed-in machine without a manual `.hover/.env` export. A bulk `Hover: Sync Test Accounts to Hover Cloud` command pushes every local account. Passwords stay in SecretStorage locally; syncing is always a choice, never a default.

## 0.39.0 — 2026-07-10

- **The map's API layer is visible.** Lines from the map's `## API` area (written automatically by `crystallize_api_spec`, `@hover-dev` 0.40) render with a 🛡 in the Business Map graph and as hexagons in the Mermaid export — API contracts read at a glance next to the UI flows, with the same run/coverage coloring.

## 0.38.0 — 2026-07-10

- **Copy the Business Map as a Mermaid diagram.** A button on the Map tab (and the `Hover: Copy Business Map as Mermaid` command) copies the map as a fenced Mermaid flowchart — paste it into a README, PR description, or doc and it renders natively on GitHub for people without Hover. app → area → business line, colored by state: green passing, red failing, amber flaky, dashed not covered; relationship edges included. Export-only — `hover-map.md` stays the source of truth.

## 0.37.0 — 2026-07-06

- **Connect the current repo to Hover Cloud, from the panel.** Signed in, the panel now tells whether *this* repo is actually a Cloud project — a detected repo with no project no longer masquerades as linked with an empty Remote/Heal. When it isn't linked, a **Create project** button opens Cloud's new-project page pre-selected to this repo (creation runs in the browser — it needs the GitHub App to write the workflow + secrets), with a **pick existing** fallback.
- **Fixed (0.35.1):** the `hover-hook` bin was a no-op when invoked via its symlink (the installed hook path), so the Claude Code hooks silently did nothing — they now fire. Update with `npm i -g @hover-dev/mcp@latest`.

## 0.33.0–0.36.0 — 2026-07-04

**The panel is one environment-aware console; sign-in is optional again.**

- **One Hover view.** Dashboard, Environments, and Business Map are now tabs in a single panel — **Overview / Heal / Environments / Map** — under one Activity Bar icon, instead of three separate views.
- **Local-first, optional sign-in.** The panel works signed out (Overview·Local, Environments, Map); signing in (device-link — approve in the browser) unlocks the Remote source + the Heal queue. Cloud-only chrome hides when signed out.
- **Guided first run.** A two-step setup wizard — optional sign-in → choose your environment (Use Local / Add an environment / Import from Cloud) — runs before the panel opens, so the active environment is a conscious choice, not a silent default.
- **Environment scope.** An environment selector filters the Remote spec matrix and the Heal queue; CI runs are per-environment end to end.
- **Env tab ↔ Cloud.** When a Cloud project is linked, the Env tab mirrors its Cloud-managed environments (name + URL), read-only, above the local roster.
- **The MCP follows the active environment.** The active env is published to `.hover/active.json`; the Hover MCP targets its URL for test/heal and loads `.hover/.env` for login. An **Agent (MCP) target** card exports the active env's credentials in one click.
- **Undo on delete.** Removing an environment or account offers **Undo** — restored verbatim with its SecretStorage passwords.
- **Fixed:** heal cards label environment vs branch (were two bare, ambiguous chips).

## 0.32.1 — 2026-07-03

- **Fixed:** the heal queue and the Remote (Cloud) dashboard now scope to the current repo, and a project picker appears when your token spans several — instead of pooling every project's queue into one list.

## 0.32.0 — 2026-07-03

**Device-link sign-in for Hover Cloud — approve in the browser, no token to paste.**

- **Hover: Connect Hover Cloud** now opens the Cloud approval page with a short code and shows a cancellable progress toast; on approval the access token is handed back automatically (one-time, 10-minute TTL) and saved to `~/.hover/credentials.json` — so the Hover MCP is signed in too. Falls back to the paste-a-token flow when the browser approval doesn't complete or the cloud lacks the endpoints.

## 0.29.0–0.31.0 — 2026-07-03

**One tabbed Hover panel (mini-cloud).**

- The separate views merged into a single tabbed **Hover** panel, with Cloud sign-in in the panel itself. The **Dashboard** tab reads Cloud CI runs through the shared `DashboardData` contract — the same UI whether the data comes from local `.hover/runs` or from Hover Cloud.
- Slimmer icon assets + the reticle favicon; the Activity Bar icon aligned to the brand mark.

## 0.25.0–0.28.0 — 2026-07-02

**Self-heal in CI + the Hover Cloud pull channel.**

- **Hover Cloud pull channel.** The extension polls the cloud heal queue (credentials in `~/.hover/credentials.json`, shared with the MCP) and notifies you when a spec drifts in CI. Nothing in the cloud drives your machine — it copies `/mcp__hover__heal <spec>` for your own agent, and the queue entry closes only when CI sees the spec pass again.
- **Self-heal mode B.** The generated CI can dispatch a drift-heal back to the editor (B1) and, opt-in, open a Claude auto-heal PR (B2).
- **Strengthened generated CI.** Sharding, scheduled monitoring, concurrency, and a run summary.

## 0.24.0 — 2026-06-27

**🏥 Self-heal — when a spec breaks because the app changed, repair it in chat instead of by hand.**

- **🏥 Heal a spec.** A saved spec failing on replay (a renamed/moved control, a drifted selector)? Click **🏥 Heal** — on the spec's CodeLens or its Dashboard row — and Hover re-runs the flow against your live app, re-locates the broken step(s) with grounded selectors, and offers a fixed candidate to review. The repair streams into the chat (you watch the agent work) and crystallizes through the normal candidate flow. Triggered from the spec, executed live; the fix is yours to review before it lands — Hover never silently rewrites a spec.
- **Finds what actually broke.** It reads the last run's failure to target the exact failing locator, and judges broke-vs-intentionally-changed (a real regression is reported, not healed away).
- **Per-spec flaky, surfaced.** The Dashboard now flags each spec that's inconsistent across runs (passed and failed in the window) with a "flaky" marker, and every row gets a 🏥 Heal action — so unstable specs are individually visible and fixable from where you see them.

Self-heal re-locates in your own browser via your own agent (BYO-CLI) — no cloud, no vendor; the fixed test stays plain `@playwright/test` you own.

## 0.23.0 — 2026-06-26

**Crystallization fidelity — saved specs hold up across runs on apps with changing content.**

- **Dynamic content → invariants, not literals.** When a recorded step targets data that varies run-to-run (a drawn word, a generated id, a date), the saved spec now anchors on a stable selector and asserts the invariant (a value is shown) instead of freezing this run's value — so it passes on the next run instead of breaking on a different word. Driven at record time, with a backstop in ✨ Optimize.
- **✨ Optimize is smarter and cheaper.** The refinement pass now reads your project's Page Objects + conventions and reuses them, de-literalizes volatile values it detects, and runs on a small model by default (Claude → `haiku`; override with the new `hover.optimizeModel` setting). The deterministic spec stays the source of truth — the model only refines, and you review the diff before promoting.
- **A QA run always offers a Crystallize card.** When a run completes a clean flow, you get a ✨ Crystallize candidate even if the agent didn't explicitly mark one.
- **Reproducible state (foundation).** Groundwork for resetting an app to a clean starting state before replay — state-reset recon, a generated `resetState()` helper, and login lifted into a Playwright `storageState` fixture. Recon clears client state, so it is off by default for now.
- **Fixed:** stray tool-call syntax a model occasionally emitted as plain text no longer leaks into the run summary or the report.

## 0.22.1 — 2026-06-21

- **Fixed:** a 0-action assistant reply (a clarification, or a short wrap-up like a security-test conclusion) rendered raw text, so `**bold**` showed its literal asterisks. The assistant bubble now renders markdown (bold / italic / bullets / headings) like the Done card and the clarify question.

## 0.22.0 — 2026-06-21

**QA Testing mode — autonomous exploratory testing, with API + Penetration testing as toggles.**

The headline release: a new **QA Testing** mode that explores your app on its own to find defects and writes a findings report, with API and penetration testing layered on as toggles. The mode picker is now just **Flow** (AI test authoring) and **QA Testing**.

- **Autonomous exploratory testing.** Point QA at a page — or just say "test the app" — and the agent systematically exercises controls, tries negative / boundary inputs, and reports real defects, instead of waiting to be told each step.
- **Intensity presets (step budget).** Quick / Standard / Deep bound a run by step count (~45 / ~150 / ~500) so "explore everything" can't run away on cost; the agent paces itself to always finish with a report.
- **API testing toggle.** Composes Hover's MITM proxy into a QA run so the agent's API calls are captured — functional / contract checks against real traffic.
- **Penetration testing toggle.** An offensive, origin-locked, own-app security pass (auth / access control, IDOR, injection, endpoint abuse). It is destructive, so it always runs as a **second phase after** the functional pass, and it is OFF by default (enabling it asks for confirmation). The functional pass now stays functional-only when a pentest pass is queued, so the two never double up on security work.
- **Findings report + coverage.** Every QA run writes a durable Markdown report with findings by severity and a `## Coverage` section (what was tested vs. left open).
- **Candidate flows → one-click Crystallize.** As QA completes a clean end-to-end flow it offers it as a ✨ Crystallize card, so a good run becomes a saved Playwright spec.
- **Business memory.** QA persists durable business rules it confirms (or that you answer) so neither it nor a future run re-asks them.
- **Pre-flight request classifier.** Before a QA run, a quick check routes your request: a concrete test runs; a vague one offers clickable options; an off-task / out-of-scope one is redirected — so the heavy exploration only kicks in for an actual test, and "read the page" is treated as "test the page".

**Speech & chat polish**

- **Voice narration** restored, with voice pickers (Chinese defaults to **Tingting**; English keeps Auto) and the novelty system voices filtered out.
- The Done card now renders markdown (headings, bold / italic, dot bullets); the QA report link is aligned.
- **Auto-scroll** follows the live run only while you're at the bottom — scroll up to read history and new output won't yank you down; sending a message re-pins you, and the live working indicator stays in view.

**Data model**

- One run-folder per agent run, grouped by conversation (`.hover/conversations/<conversationId>/<runId>/{meta.json, report.md, screenshots/}`) — deleting a conversation cleanly removes all of its runs.

## 0.21.0 — 2026-06-20

**Unified panels + Tailwind refresh, light-theme fix, engine cleanup.**

- **Fixed:** in a light VS Code theme the chat accent rendered as bright mint instead of the deep green, washing out the message bubble + send button. Restored.
- **All five panels now share one React app.** Settings, Dashboard, Conversations, and Network were migrated from hand-rendered HTML to the same React + routing the chat already used — one bundle, consistent behaviour, and styling unified on Tailwind that tracks your VS Code theme (light / dark / high-contrast). No behaviour change you should notice; everything renders as before.
- **Engine internals:** the report parser is markdown-first (no fragile JSON blob), a built-in mode-behaviour table replaces scattered conditionals (groundwork for upcoming modes), and the prompt directives were extracted for clarity.
- **Housekeeping:** removed the obsolete CLI dev scripts (`pnpm smoke` / `detect` / `bench-*` …) now that the extension is the dev surface.

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
