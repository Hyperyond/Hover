# Roadmap

What's shipped, what's in flight.

| Version | Theme | Status |
|---|---|---|
| **v0.0.1-poc** | Phase 0 — end-to-end feasibility (`claude -p` drives Chrome via CDP) | ✅ Shipped |
| **v0.1.x** | Phase 1 — Vite plugin + chat UI + persistent service + Save as Spec | ✅ Shipped |
| **v0.2.x** | Phase 2 — multi-agent (claude + codex), dark widget v2, Result + Findings cards, custom tooltip | ✅ Shipped |
| **v0.3.x** | `@hover-dev/next` — Next.js 16+ Turbopack-native integration | ✅ Shipped |
| **v0.4.x** | Click → Suggest fix prompt | ✅ Shipped |
| **v0.5.x** | Merged Record + Assert workflow (Record / Exists / Says / Equals sub-toolbar) | ✅ Shipped |
| **v0.6.x** | **Voice mode** — push-to-talk STT + spoken progress narration, browser-native, zh/en autodetect, Chrome 139+ on-device | ✅ Shipped |
| **v0.7.x** | **Security testing + plugin API** — `@hover-dev/security` (HTTPS MITM, captured-flow inspector, IDOR / authz probing MCP) + `defineHoverPlugin` manifest API behind it | ✅ Shipped |
| **v0.8.x** | **Multi-framework source attribution + integration overhaul** — JSX / Vue / Svelte / Astro `data-hover-source` stamps via the private `@hover-dev/transform-source`; `@hover-dev/next` gains plugin support via `register()`'s second arg | ✅ Shipped |
| **v0.9.x** | **Widget plugin-UI protocol + cursor-agent** — `window.__HOVER_WIDGET__` host API (namespaced CSS / DOM mutations / toolbar buttons / overlays / WS message handlers / lifecycle); `@hover-dev/security` migrates onto it; `cursor-agent` joins the registry | ✅ Shipped |
| **v0.10.x** | **Multi-tab agent reliability + 3 more agents** — system-prompt addendum for popup checkouts / OAuth chains / post-popup state, `pnpm bench-multi-tab` for A/B'ing prompt changes, two-step card+OTP `examples/payment-provider`, `aider` + `gemini-cli` + `qwen-code` in the registry | ✅ Shipped |
| **v0.11.x** | **Spec resilience: ⟳ Re-record + Saved-sessions overlay + FAQ** — when a saved spec breaks (UI changed), Re-record button (widget) or `pnpm hover re-record <spec>` (CLI) replays the JSDoc `Original prompt:` against the current UI and overwrites the file. Widget gains the Skills+Specs tabbed overlay. README + docs site gain a top-level FAQ explaining why we don't self-heal at CI time | ✅ Shipped |
| **v0.12.x** | **Security spec recording semantics** — `replay_flow` MCP tool gains `intent` + `expectStatus` parameters that record the replay as a security check. Save-as menu sprouts a "Security spec" entry that writes `__vibe_tests__/<slug>.security.spec.ts` — plain Playwright with the `request` fixture, one `test()` per recorded check. Also: server `HoverPluginManifest.saveHandlers` + widget `WidgetPluginSpec.saveEntries` plugin extension points | ✅ Shipped (**you are here**) |
| **v0.13.x or sibling repo** | Chrome extension — drops bundler-plugin dependency, drives any tab (staging, third-party). Likely a separate `hover-extension` repo (Web Store cadence shouldn't gate on monorepo PRs). Loses source attribution, gains universal coverage | 🟡 Planned |

## v0.13.x+ scope (planned)

- **Chrome extension** as a sibling product. Targets the "AI tests any live site" use case (staging URLs, third-party sites, multi-origin flows) — distinct from the Vite-plugin product line which targets "AI rewrites your dev-server's source." Likely a separate `hover-extension` repo because Chrome Web Store releases are manual and would mis-fit this monorepo's auto-publish workflow.

- **Re-record `--failed` / `--all`.** Batched spec resilience: feed Playwright's failure list into `hover re-record --failed` to re-record only the broken specs in one pass. v0.11 ships single-spec re-record on purpose ([rationale in FAQ](/faq#why-no-re-record-all-or-failed)) but the batched form is on the roadmap once we have real signal from how single-spec usage shakes out.

## Beyond v0.12.x

- **Voice mode Pro** (opt-in) — Deepgram Nova-3 streaming STT + ElevenLabs Flash / Cartesia Sonic TTS as an env-var-gated upgrade for users who want sub-100ms TTFA or higher-fidelity 中文 recognition. LLM stays on the user's local CLI agent — only the I/O adapters are cloud. Brings new privacy boundary (audio leaves the browser); will be opt-in, never default.
- **AI-compiled spec output** — `writeSpec.ts` calls the local CLI agent to AI-compile `state.messages` + `state.assertions` into a polished `.spec.ts`, falling back to the existing deterministic codegen on failure. The AI is an authoring-time aid, not a CI dependency.

For real-time tracking, see [github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues).
