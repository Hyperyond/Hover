# Voice mode

Speak your prompt; hear the agent's progress.

::: info Status
**Shipped in v0.6.0.** Available in every Hover-enabled dev server today.
:::

## How it works

Hold the round **🎙** button to the right of Send (push-to-talk). The icon switches to a live elapsed-seconds counter and a mint glow pulses around the button while listening. Speak — in 中文 or English — and release.

- Mid-sentence pauses **don't** cut you off. Recognition stays open until you release.
- Interim transcripts echo into the textarea live, so you see what the engine is hearing.
- On release, the final transcript fires `submit()` — same code path as typing — and the textarea clears.

While the agent works, key step events get spoken aloud:

- **`tool_use`** — humanized: `Opening page` / `Clicking Submit` / `Filling form`. Diagnostic-only tools (`browser_snapshot`, `browser_take_screenshot`) are deliberately silent.
- **`text`** — first sentence of the agent's narration, capped at 60 chars.
- **`session_end`** — `Done in N steps.` / `Stopped.` / `Something went wrong.`

Press **Stop**, click a new prompt, or open the mic again to interrupt any in-flight utterance immediately.

## Languages

Hover detects the language of your latest prompt (CJK regex) and routes:

| Layer | Behaviour |
|---|---|
| **STT** | `SpeechRecognition.lang` defaults to `zh-CN`. The hint flips to `en-US` if your last AI text reply was English. |
| **TTS phrasing** | `humanizeTool()` emits `点击登录按钮` / `Clicking Submit` per language. `session_end` says `完成，共 5 步` / `Done in 5 steps.` |
| **Voice picker** | `pickVoice()` scores by name markers — prefers Siri / Premium / Enhanced / Google / Neural over legacy system voices. Within `zh`, prefers `zh-CN` over `zh-TW`. |

The user's prompt language wins over the agent's reply language — `claude` / `codex` commonly answer in English even after a Chinese prompt, but TTS narration sticks with your context.

## Privacy

- **No cloud round-trip.** Both STT and TTS use the browser's built-in Web Speech API.
- **Chrome 139+ runs STT on-device** via SODA (Speech On-Device API). The first push-to-talk installs the language packs lazily (`SpeechRecognition.install({ langs: ['zh-CN', 'en-US'], processLocally: true })`); subsequent recordings never leave the browser.
- **No new API keys.** No `.env` entries. No service-side changes — the Node service didn't grow a single network call.
- **Firefox** ships `SpeechRecognition` behind a flag (`dom.webspeech.recognition.enable`). The mic button is disabled with a "use Chrome" tooltip.

## Settings

Open the **⚙** button in the widget header. The settings overlay has a **Speech narration** toggle:

- **On** (default) — agent step events get spoken aloud.
- **Off** — silent. In-flight utterances are cancelled immediately on toggle.

State persists in `localStorage` under a key (`hover:settings:v1`) that's independent of your chat history, so future settings additions won't bump the chat schema.

## Implementation notes (for the curious)

All voice logic lives in [`packages/widget-bootstrap/src/widget/voice.js`](https://github.com/Hyperyond/Hover/blob/main/packages/widget-bootstrap/src/widget/voice.js) — pure helpers + two thin factories around `SpeechRecognition` and `SpeechSynthesis`.

Two non-obvious correctness fixes:

- **`continuous = true` + final-transcript accumulation.** With the default `continuous = false`, the engine ends recognition after ~1s of silence — so a thoughtful pause would cut off your sentence. Hover sets `continuous = true` and concatenates `isFinal` segments across multiple `onresult` batches; the result fires only when `stop()` is called.
- **`voiceschanged` race.** Chrome returns `[]` from `getVoices()` on first call, with the real list arriving on a `voiceschanged` event. Without an explicit wait, the first utterance picks a null voice and the engine reads Chinese text with an English voice. `waitForVoices()` fires on WS open (well before any speech is queued) so the first sentence already has a correct voice.

## Roadmap

Voice mode v0.6.0 is intentionally MVP. The next stages:

- **Pro mode** (`HOVER_VOICE_PROVIDER=deepgram+elevenlabs`) — opt-in cloud STT/TTS for users who want higher-fidelity 中文 recognition or sub-100ms TTS first-token latency. LLM stays on your local CLI agent — only the I/O adapters are cloud.
- **Per-voice picker in settings** — let users override the auto-selected voice from a dropdown.
- **STT language hint UI** — small flag indicator on the mic icon showing which language the engine is currently configured for.

See [Roadmap](/reference/roadmap) for the full picture.
