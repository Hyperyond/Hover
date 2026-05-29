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
| **v0.9.x** | **Widget plugin-UI protocol + cursor-agent** — `window.__HOVER_WIDGET__` host API (namespaced CSS / DOM mutations / toolbar buttons / overlays / WS message handlers / lifecycle); `@hover-dev/security` migrates onto it; `cursor-agent` joins the registry | ✅ Shipped (**you are here**) |
| **v0.10.x** | Multi-tab / cross-origin polish + more agents + Chrome extension | 🟡 Planned |
| **v0.11.x** | Recording semantics for security mode — security regression specs from captured flows + agent replays | 🟡 Planned |

## v0.10.x scope (planned)

- **Multi-tab / cross-origin flows** — Stripe, OAuth, "Pay with PayHover" popup patterns. `examples/payment-provider` already stresses the `window.open → postMessage` path, but the agent's handling of `browser_tabs(list/select)` is brittle in the wild.
- **More agents in the [registry](./agent-registry)** — `aider`, `gemini-cli`, `qwen-code`. (`cursor-agent` shipped in v0.9.)
- **Chrome extension** — drops the Vite-plugin dependency for non-Vite stacks. The widget UI is the same.

## v0.11.x scope (planned)

- **Recording semantics for security mode.** Re-purpose the Record button while a security mode (or future probing mode) is active so a session captures the agent's replay decisions + asserts the server response shape, crystallising into a security regression spec. Now a security-side change thanks to the v0.9 widget plugin-UI protocol — zero changes to core widget code.

## Beyond v0.11.x

- **Voice mode Pro** (opt-in) — Deepgram Nova-3 streaming STT + ElevenLabs Flash / Cartesia Sonic TTS as an env-var-gated upgrade for users who want sub-100ms TTFA or higher-fidelity 中文 recognition. LLM stays on the user's local CLI agent — only the I/O adapters are cloud. Brings new privacy boundary (audio leaves the browser); will be opt-in, never default.
- **AI-compiled spec output** — `writeSpec.ts` calls the local CLI agent to AI-compile `state.messages` + `state.assertions` into a polished `.spec.ts`, falling back to the existing deterministic codegen on failure. The AI is an authoring-time aid, not a CI dependency.

For real-time tracking, see [github.com/Hyperyond/Hover/issues](https://github.com/Hyperyond/Hover/issues).
