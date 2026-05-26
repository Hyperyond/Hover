/**
 * Hover widget — voice mode primitives.
 *
 * Pure helpers + two thin factories around the browser-native Web Speech API
 * (`SpeechRecognition` for STT, `SpeechSynthesis` for TTS). Two consumption
 * paths share this file:
 *
 *   1. The browser widget IIFE concatenates voice.js into the inline-script
 *      bundle (via buildWidgetBundle), with `export` keywords stripped. All
 *      top-level declarations become plain bindings inside the IIFE closure.
 *   2. Vitest imports this file as a real ES module to unit-test the pure
 *      helpers (shouldSpeak, humanizeTool, detectLanguage, pickVoice,
 *      detectVoiceSupport).
 *
 * Keep this file free of `document` / shadow-root references — only `window`
 * touch-points are the standard Web Speech globals, and tests stub them via
 * `vi.stubGlobal`.
 *
 * MVP scope (no env-var opt-in, no cloud STT/TTS, no service-side changes):
 *   - Push-to-talk STT: user holds the mic button, interim transcripts echo
 *     into the textarea, final transcript triggers the existing submit().
 *   - Event TTS: shouldSpeak() decides which InvokeEvents are worth speaking
 *     and produces the text; createSpeaker() queues utterances and picks a
 *     voice that matches the text's language (zh/en autodetect).
 *
 * Chrome 139+ on-device mode: when SpeechRecognition.install() exists we
 * eagerly ask for SODA language packs with `processLocally: true` so audio
 * never leaves the browser. Failure is non-fatal — we fall back to the
 * default (cloud) recognition path so users on older Chromes still work.
 */

// ─── Tool humanizer ─────────────────────────────────────────────────────

function clipText(s, max = 24) {
  if (typeof s !== 'string') return '';
  const trimmed = s.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Tiny i18n phrase book. Each entry returns the spoken sentence for a tool +
 * input combo, in the requested language. We deliberately AVOID reading URLs
 * aloud (any zh voice butchers "localhost:5173", any en voice butchers a
 * Chinese path) — the URL is on screen, ears get a verb + label.
 *
 * Element / text values DO get spoken because they're usually user-meaningful
 * labels like "Login button" or "登录" that the voice handles fine.
 */
const PHRASES = {
  zh: {
    navigate: () => '打开页面',
    click: (label) => (label ? `点击${label}` : '点击'),
    type: (label) => (label ? `在${label}里输入` : '输入'),
    fill_form: () => '填写表单',
    select: (label) => (label ? `选择${label}` : '选择'),
    wait: () => '等待中',
    tab_select: () => '切换标签页',
    tab_new: () => '新开标签页',
    close: () => '关闭浏览器',
    hover: (label) => (label ? `悬停在${label}` : '悬停'),
    press: (key) => (key ? `按下${key}` : '按键'),
  },
  en: {
    navigate: () => 'Opening page',
    click: (label) => (label ? `Clicking ${label}` : 'Clicking'),
    type: (label) => (label ? `Typing in ${label}` : 'Typing'),
    fill_form: () => 'Filling form',
    select: (label) => (label ? `Selecting ${label}` : 'Selecting'),
    wait: () => 'Waiting',
    tab_select: () => 'Switching tab',
    tab_new: () => 'Opening new tab',
    close: () => 'Closing browser',
    hover: (label) => (label ? `Hovering on ${label}` : 'Hovering'),
    press: (key) => (key ? `Pressing ${key}` : 'Pressing key'),
  },
};

/**
 * Convert one mcp__playwright tool_use into a short, speakable sentence in
 * the requested language (`lang` is 'zh' or 'en'; anything else → 'en').
 * Returns null for tools we don't narrate. Caller (shouldSpeak) decides the
 * language based on the user's most recent prompt.
 */
export function humanizeTool(tool, input, lang = 'en') {
  if (typeof tool !== 'string') return null;
  const t = tool.replace(/^mcp__playwright__/, '');
  const i = input && typeof input === 'object' ? input : {};
  const p = lang === 'zh' ? PHRASES.zh : PHRASES.en;

  switch (t) {
    case 'browser_navigate':
      return p.navigate();
    case 'browser_click':
      return p.click(clipText(i.element || i.text || i.ref || ''));
    case 'browser_double_click':
      return p.click(clipText(i.element || ''));
    case 'browser_hover':
      return p.hover(clipText(i.element || ''));
    case 'browser_type':
      return p.type(clipText(i.element || ''));
    case 'browser_press_key':
      return p.press(typeof i.key === 'string' ? i.key : '');
    case 'browser_fill_form':
      return p.fill_form();
    case 'browser_select_option':
      return p.select(clipText(i.element || ''));
    case 'browser_wait_for':
      return p.wait();
    case 'browser_snapshot':
    case 'browser_take_screenshot':
    case 'browser_resize':
    case 'browser_evaluate':
    case 'browser_console_messages':
    case 'browser_network_requests':
      return null; // Diagnostic-only, not interesting to speak
    case 'browser_tabs': {
      const action = typeof i.action === 'string' ? i.action : '';
      if (action === 'select') return p.tab_select();
      if (action === 'new') return p.tab_new();
      return null;
    }
    case 'browser_close':
      return p.close();
    default:
      return null;
  }
}

// ─── Language detection + voice pick ────────────────────────────────────

const CJK_RE = /[一-鿿]/;

/**
 * Cheap language detection for TTS voice selection. Hover targets zh + en
 * MVP; anything outside zh falls through to 'en'. If we later need broader
 * coverage (ja / ko), expand here.
 */
export function detectLanguage(text) {
  if (typeof text !== 'string' || text.length === 0) return 'en';
  return CJK_RE.test(text) ? 'zh' : 'en';
}

/**
 * Score a voice by quality heuristics. Higher = better. Reads voice.name +
 * voice.voiceURI for the marker strings we know correlate with the high-
 * quality neural voices on common platforms:
 *
 *   - macOS Safari/Chrome: "Siri"-prefixed voices use the system neural
 *     engine and sound dramatically better than the legacy Tingting / Mei-Jia
 *     / Samantha voices. "Premium" / "Enhanced" name suffixes mark the
 *     downloaded high-quality variants.
 *   - Chrome Desktop (all OS): "Google " prefix means Google's cloud voices
 *     (zh-CN ones are excellent; en-US "Google US English" is solid).
 *   - Edge: "Microsoft … Online" / "Natural" markers.
 *
 * The ranking is heuristic and intentionally generous — we always have the
 * fallback path of `voice.default`, then "first match". An unknown voice in
 * the right language is still better than no voice (the engine would pick
 * a wrong-language default if we returned null).
 */
function scoreVoice(v) {
  const id = `${v.name || ''} ${v.voiceURI || ''}`.toLowerCase();
  let score = 0;
  if (id.includes('siri')) score += 100;
  if (id.includes('premium')) score += 60;
  if (id.includes('enhanced')) score += 50;
  if (id.includes('neural')) score += 50;
  if (id.includes('natural')) score += 40;
  if (id.includes('google ')) score += 45;
  if (id.includes('microsoft') && id.includes('online')) score += 35;
  // Local synthesis usually = lower latency; tiny tiebreaker.
  if (v.localService) score += 1;
  // `default` voice is a weak signal — it might be a low-quality system
  // voice picked once in 2007 and never updated. Tiny bonus only.
  if (v.default) score += 2;
  return score;
}

/**
 * Pick a SpeechSynthesisVoice matching `lang` ('zh' | 'en'). Strategy:
 *   1. Filter by lang prefix (zh-* / en-*).
 *   2. Sort by scoreVoice() descending — prefers Siri / Premium / Google /
 *      Enhanced / Neural before falling back to legacy system voices.
 *   3. Return the top scorer. Null only if no voice matches the language
 *      at all (caller falls back to the engine default — usually worse).
 */
export function pickVoice(synth, lang) {
  if (!synth || typeof synth.getVoices !== 'function') return null;
  const voices = synth.getVoices();
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const prefix = lang === 'zh' ? 'zh' : 'en';
  const matches = voices.filter(
    (v) => typeof v.lang === 'string' && v.lang.toLowerCase().startsWith(prefix),
  );
  if (matches.length === 0) return null;
  // For zh, weakly prefer zh-CN over zh-TW / zh-HK so a generic "中文" voice
  // doesn't get spoken with a Taiwanese accent when the user is on mainland.
  matches.sort((a, b) => {
    const sa = scoreVoice(a) + (lang === 'zh' && /^zh-cn/i.test(a.lang) ? 5 : 0);
    const sb = scoreVoice(b) + (lang === 'zh' && /^zh-cn/i.test(b.lang) ? 5 : 0);
    return sb - sa;
  });
  return matches[0];
}

/**
 * Wait for the speech synthesis voices list to populate. Chrome loads voices
 * asynchronously — `getVoices()` returns `[]` synchronously on first call,
 * then a `voiceschanged` event fires once the list is ready. Without this
 * await, the very first utterance picks a null voice and the engine reads
 * Chinese text with an English voice (the bug the user just reported).
 *
 * Resolves immediately if voices are already loaded, or once voiceschanged
 * fires. Hard timeout of 2s so we never block forever — at worst the first
 * utterance uses the default voice, same as the old behaviour.
 */
export function waitForVoices(synth, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!synth || typeof synth.getVoices !== 'function') {
      resolve([]);
      return;
    }
    const initial = synth.getVoices();
    if (initial && initial.length > 0) {
      resolve(initial);
      return;
    }
    let settled = false;
    const onChange = () => {
      if (settled) return;
      settled = true;
      try { synth.removeEventListener('voiceschanged', onChange); } catch {}
      resolve(synth.getVoices() || []);
    };
    try { synth.addEventListener('voiceschanged', onChange); } catch {}
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { synth.removeEventListener('voiceschanged', onChange); } catch {}
      resolve(synth.getVoices() || []);
    }, timeoutMs);
  });
}

// ─── Event → speech decision ────────────────────────────────────────────

const SENTENCE_BREAK_RE = /[.!?。！？\n]/;

function firstSentence(text, max = 60) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const idx = trimmed.search(SENTENCE_BREAK_RE);
  const head = idx > 0 ? trimmed.slice(0, idx) : trimmed;
  return head.length > max ? `${head.slice(0, max)}…` : head;
}

const SESSION_END_PHRASES = {
  zh: {
    stopped: '已停止',
    error: '出错了',
    done: (turns) => (turns != null ? `完成，共 ${turns} 步` : '完成'),
  },
  en: {
    stopped: 'Stopped.',
    error: 'Something went wrong.',
    done: (turns) => (turns != null ? `Done in ${turns} step${turns === 1 ? '' : 's'}.` : 'Done.'),
  },
};

/**
 * Decide whether a normalized InvokeEvent should be spoken, and what to say.
 * `langHint` (zh|en) tells us which language the user's latest prompt was in
 * — defaults to detection from the event's own payload when no hint exists.
 *
 *   - tool_use: humanize the playwright call in the hinted language.
 *   - text: agent narration — speak the first sentence (≤ 60 chars). Cap is
 *     intentionally short: longer utterances get cut off by the next tool
 *     event anyway, and shorter chunks let the user act on info sooner.
 *   - session_end: short status template in the hinted language.
 *   - everything else: silent.
 */
export function shouldSpeak(event, langHint) {
  if (!event || typeof event !== 'object') return { speak: false, text: null };
  const lang = langHint === 'zh' ? 'zh' : 'en';
  switch (event.kind) {
    case 'tool_use': {
      const phrase = humanizeTool(event.tool, event.input, lang);
      return phrase ? { speak: true, text: phrase } : { speak: false, text: null };
    }
    case 'text': {
      const head = firstSentence(event.text, 60);
      return head ? { speak: true, text: head } : { speak: false, text: null };
    }
    case 'session_end': {
      const tpl = SESSION_END_PHRASES[lang];
      if (event.cancelled) return { speak: true, text: tpl.stopped };
      if (event.isError) return { speak: true, text: tpl.error };
      if (event.summary) {
        const head = firstSentence(event.summary, 80);
        if (head) return { speak: true, text: head };
      }
      const turns = typeof event.turns === 'number' ? event.turns : null;
      return { speak: true, text: tpl.done(turns) };
    }
    default:
      return { speak: false, text: null };
  }
}

// ─── Feature detection ──────────────────────────────────────────────────

/**
 * Detect Web Speech availability in the current window. Used by the widget
 * to enable/disable the mic button and surface a useful tooltip. Pulls
 * `window` off `globalThis` so vitest can stub the global without touching
 * a real DOM.
 */
export function detectVoiceSupport() {
  const w = typeof globalThis !== 'undefined' ? globalThis : {};
  const reasons = [];
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition || null;
  const stt = !!SR;
  if (!stt) reasons.push('Speech recognition not supported in this browser (try Chrome).');
  const tts = !!(w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function');
  if (!tts) reasons.push('Speech synthesis not supported.');
  // Chrome 139+: SpeechRecognition.install() pulls SODA language packs and
  // keeps audio local. We feature-detect by checking the static method on
  // the constructor (not the prototype) — that's where the spec puts it.
  const onDevice = !!(SR && typeof SR.install === 'function');
  return { stt, tts, onDevice, reasons };
}

// ─── Recognizer factory (STT) ───────────────────────────────────────────

/**
 * Wrap the browser's SpeechRecognition into a small push-to-talk API.
 * Caller owns the lifecycle: start() on pointerdown, stop() on pointerup.
 * Callbacks fire as the engine emits results / errors. `lang` defaults to
 * 'zh-CN' but is intentionally configurable per-start so we can swap based
 * on UI hint or last agent reply language.
 *
 * Returns null in environments without SpeechRecognition (Firefox, etc.).
 */
export function createRecognizer({ onInterim, onFinal, onError, onEnd, lang = 'zh-CN' } = {}) {
  const w = typeof globalThis !== 'undefined' ? globalThis : {};
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;

  // Best-effort on-device pack install. We don't await it — the very first
  // start() might still hit the cloud, but subsequent starts will be local
  // once the pack lands. Errors here never block STT.
  if (typeof SR.install === 'function') {
    try {
      SR.install({ langs: ['zh-CN', 'en-US'], processLocally: true });
    } catch {
      /* non-fatal: cloud mode keeps working */
    }
  }

  // Push-to-talk semantics: while the user holds the button, we want a single
  // utterance from start() to stop(), even across mid-sentence pauses. This
  // requires:
  //
  //   1. continuous = true — without this, the engine ends the recognition
  //      automatically when it detects ~1s of silence, which makes any
  //      thoughtful pause cut off the user's sentence (the bug the user
  //      reported as "长按麦克风会自动结束").
  //   2. Accumulate final transcripts across multiple onresult batches —
  //      with continuous mode the engine emits several isFinal segments
  //      (one per detected pause). We concat them and submit a single
  //      sentence only when stop() is called (release).
  //   3. Watch for Chrome's "no-speech" auto-end and silently restart if
  //      the user is still holding the mic (Chrome still ends the session
  //      after ~7-10s of total silence even in continuous mode; this hides
  //      that quirk so push-to-talk feels infinite until release).

  let active = false;
  let releasing = false; // set true by stop() so onend submits instead of restarting
  let rec = null;
  let finalAcc = '';
  let lastInterim = '';
  let currentLang = lang;

  const cleanup = () => {
    active = false;
    rec = null;
  };

  const reset = () => {
    finalAcc = '';
    lastInterim = '';
    releasing = false;
  };

  const buildRec = () => {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = currentLang;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg = e.results[i];
        if (seg.isFinal) finalAcc += seg[0].transcript;
        else interim += seg[0].transcript;
      }
      lastInterim = interim;
      if (onInterim) {
        // Echo the running transcript: final segments already committed +
        // the current interim tail. Gives a smooth live preview rather
        // than blinking back to "" between segments.
        onInterim(`${finalAcc}${interim}`.trim());
      }
    };
    r.onerror = (e) => {
      const err = e?.error || 'unknown';
      // 'no-speech' / 'aborted' are benign — Chrome auto-ending the segment.
      // If the user is still holding the mic (active && !releasing), keep
      // the session alive by restarting the recognizer. Otherwise treat as
      // a quiet end (don't surface as an error toast).
      if (err === 'no-speech' || err === 'aborted') {
        if (active && !releasing) {
          // Restart silently; onend will fire and our onend handler decides
          // whether to restart based on the same flags.
          return;
        }
        // User had already released; let onend close us out.
        return;
      }
      if (onError) onError(err);
      releasing = true; // prevent onend from restarting
    };
    r.onend = () => {
      // Recognizer ended for one of three reasons:
      //   - stop() was called (releasing=true) → finalize: deliver the
      //     accumulated transcript and clean up.
      //   - non-fatal silence auto-end while user is still holding the mic
      //     (active && !releasing) → restart silently so push-to-talk
      //     stays "infinite" until release.
      //   - a fatal error already flipped releasing=true → finalize.
      if (active && !releasing) {
        try { rec?.start(); } catch { releasing = true; }
        return;
      }
      const out = `${finalAcc}${lastInterim}`.trim();
      cleanup();
      if (onEnd) onEnd();
      if (out && onFinal) onFinal(out);
      reset();
    };
    return r;
  };

  const start = (overrideLang) => {
    if (active) return;
    currentLang = overrideLang || lang;
    reset();
    active = true;
    rec = buildRec();
    try {
      rec.start();
    } catch (err) {
      if (onError) onError(err?.message || 'start failed');
      cleanup();
      reset();
    }
  };

  const stop = () => {
    if (!active || !rec) return;
    releasing = true;
    try {
      rec.stop();
    } catch {
      /* already stopped — onend will fire anyway */
    }
  };

  const isListening = () => active;

  return { start, stop, isListening };
}

// ─── Speaker factory (TTS) ──────────────────────────────────────────────

/**
 * Wrap SpeechSynthesis with a single utterance queue. Each speak() call
 * enqueues a chunk; we play them serially so multi-sentence agent text
 * doesn't overlap with the next tool_use phrase. cancel() drops the
 * whole queue (used when the user presses mic — they shouldn't have to
 * out-shout the previous utterance).
 *
 * `getVoiceForText(text)` is supplied by the caller and lets the widget
 * pick a language-appropriate voice per utterance (zh vs en). It can
 * return null — in that case the engine uses its default voice.
 */
export function createSpeaker({ getVoiceForText } = {}) {
  const w = typeof globalThis !== 'undefined' ? globalThis : {};
  const synth = w.speechSynthesis;
  if (!synth || typeof w.SpeechSynthesisUtterance !== 'function') return null;

  const queue = [];
  let playing = false;

  const playNext = () => {
    if (playing) return;
    const next = queue.shift();
    if (!next) return;
    const u = new w.SpeechSynthesisUtterance(next);
    if (typeof getVoiceForText === 'function') {
      const v = getVoiceForText(next);
      if (v) u.voice = v;
      // Set lang explicitly so the engine picks a sane voice when our hint
      // is null. zh-CN as fallback for Chinese text, en-US otherwise.
      u.lang = v?.lang || (detectLanguage(next) === 'zh' ? 'zh-CN' : 'en-US');
    }
    u.onend = () => {
      playing = false;
      playNext();
    };
    u.onerror = () => {
      playing = false;
      playNext();
    };
    playing = true;
    try {
      synth.speak(u);
    } catch {
      playing = false;
      playNext();
    }
  };

  const speak = (text) => {
    if (typeof text !== 'string' || text.trim().length === 0) return;
    queue.push(text);
    playNext();
  };

  const cancel = () => {
    queue.length = 0;
    playing = false;
    try {
      synth.cancel();
    } catch {
      /* no-op */
    }
  };

  const isSpeaking = () => playing || queue.length > 0;

  return { speak, cancel, isSpeaking };
}
