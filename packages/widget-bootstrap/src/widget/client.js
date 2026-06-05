// Hover widget — injected by @hover/vite-plugin into the user's dev page.
// Plain JS (no transpilation), self-isolating via Shadow DOM.
// Marked with data-hover="true" so future Playwright runs can skip it.
//
// HTML + CSS live in sibling files (template.html, style.css). The Vite
// plugin reads all three at request time and concatenates them into a single
// <script> block. Inside this IIFE we read the HTML/CSS off the globals the
// plugin set in the preamble:
//
//   window.__HOVER_PORT__   = <ws port>
//   window.__HOVER_CSS__    = <contents of style.css>
//   window.__HOVER_HTML__   = <contents of template.html>

(() => {
  const HOST_ID = 'hover-widget-host';
  if (document.getElementById(HOST_ID)) return; // HMR re-injection guard

  const PORT = window.__HOVER_PORT__ ?? 51789;
  const WS_URL = `ws://127.0.0.1:${PORT}`;
  const STORAGE_KEY = 'hover:state:v1';
  const MESSAGE_CAP = 200;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-hover', 'true');
  document.body.appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${window.__HOVER_CSS__ ?? ''}</style>${window.__HOVER_HTML__ ?? ''}`;

  const $ = (sel) => root.querySelector(sel);
  const launcher = $('.launcher');
  const panel = $('.panel');
  const statusEl = $('.status');
  const newBtn = $('.newbtn');
  const skillsBtn = $('.skillsbtn');
  const starBtn = $('.starbtn');
  const skillsOverlay = $('.skills-overlay');
  const skillsListEl = $('.skills-list-items');
  const skillsCountEl = $('.skills-count');
  const skillsCloseBtn = $('.skills-close');
  // Specs tab — v0.11 added. Same overlay as Skills (tabbed), so the
  // close button is shared.
  const specsListEl = $('.specs-list-items');
  const specsCountEl = $('.specs-count');
  const assertBtn = $('.assertbtn');
  const assertCountEl = $('.assert-count');
  const recordBtn = $('.record-btn');
  const recLabel = $('.rec-label');
  const micBtn = $('.mic-btn');
  const micTimerEl = micBtn?.querySelector('.mic-timer');
  const bodyEl = $('.body');
  const textarea = $('textarea');
  const sendBtn = $('.send');
  const costEl = $('.cost');
  const cdpOverlay = $('.cdp-overlay');
  const cdpIconEl = $('.cdp-icon');
  const cdpTitleEl = $('.cdp-title');
  const cdpBodyEl = $('.cdp-body');
  const cdpActionEl = $('.cdp-action');
  const agentBtn = $('.agentbtn');
  const agentLabelEl = $('.agent-label');
  const agentWarnEl = $('.agent-warn');
  const agentsOverlay = $('.agents-overlay');
  const agentsListEl = $('.agents-list-items');
  const agentsCountEl = $('.agents-overlay .count');
  const agentsCloseBtn = $('.agents-close');
  const modeBtn = $('.modebar');
  const modeLabelEl = $('.modebar-label');
  const modeHintEl = $('.modebar-hint');
  const modesOverlay = $('.modes-overlay');
  const modesListEl = $('.modes-list-items');
  const modesCountEl = $('.modes-overlay .count');
  const modesCloseBtn = $('.modes-close');
  const settingsBtn = $('.settingsbtn');
  const settingsOverlay = $('.settings-overlay');
  const settingsCloseBtn = $('.settings-close');
  const settingsTtsToggle = $('.settings-tts-toggle');
  const settingsReloadToggle = $('.settings-reload-toggle');

  // ───────────────────────── persistent state ─────────────────────────
  // Survives panel close, page reload, and AI-driven navigations within
  // localhost. Schema is `v1` — bump STORAGE_KEY if shape changes.
  //
  //   messages: ordered list of semantic messages (not HTML)
  //   sessionId: most recent agent session id, used to --resume on next send

  const state = {
    messages: [], sessionId: null, open: false, assertions: [],
    // Multi-agent: server sends `agents` after `hello`. Until then these are
    // best-effort placeholders so the button has something to show.
    currentAgent: 'claude',
    availableAgents: [],
    // Plugin-contributed modes: server's `modes` payload. `currentMode`
    // is null in normal (unmoded) operation; otherwise it's the active
    // plugin's mode.id (e.g. 'security'). `availableModes` is the catalog
    // — empty array when no plugins are loaded, in which case the whole
    // mode pill stays hidden.
    currentMode: null,
    availableModes: [],
  };

  // Whether an agent is currently running. The renderer reads this to decide
  // "is the trailing open group still live?" — moved up here from the WS
  // handler block so `renderAll` (defined ~600 lines earlier than setRunning)
  // closes over the same binding.
  let running = false;

  // Step aggregation: see packages/widget-bootstrap/src/widget/reducer.js
  // for the pure transforms (groupMessages, extractFindings, stripMarkdown,
  // classifySeverity, plus the NOTEWORTHY_AI / HIDDEN_TOOLS / BOUNDARY_TOOLS /
  // MAX_TOOLS_PER_GROUP constants). That file is concatenated into this
  // widget at plugin build time (with `export` keywords stripped) so its
  // declarations are visible in this closure as plain bindings. Unit tests
  // live in packages/widget-bootstrap/tests/reducer.test.js — keep this
  // file free of grouping logic, edit reducer.js instead.
  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / privacy mode — degrade silently */
    }
  };

  // Debounced variant used on hot paths (every tool_use / ai-text event during
  // a run). A long agent run can fire 50+ events in a few seconds; each one
  // used to synchronously JSON.stringify the whole state (capped 200 msg list,
  // a few KB at minimum) and hit localStorage. Coalescing to one write per
  // 250ms keeps the chat log persistent for normal restart/HMR (loss window
  // is the in-flight events only) while making the per-event cost effectively
  // zero. A visibilitychange/pagehide handler below flushes the pending
  // write so tab-close or refresh never drops the latest state.
  let saveStateTimer = null;
  const scheduleSaveState = () => {
    if (saveStateTimer != null) return;
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      saveState();
    }, 250);
  };
  const flushSaveState = () => {
    if (saveStateTimer != null) {
      clearTimeout(saveStateTimer);
      saveStateTimer = null;
    }
    saveState();
  };
  // Flush on tab hide / unload so we don't lose pending writes even though
  // the hot path is debounced. visibilitychange + pagehide cover the modern
  // mobile/Safari edge cases that 'beforeunload' alone misses.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveStateTimer != null) {
      flushSaveState();
    }
  });
  window.addEventListener('pagehide', flushSaveState);

  // Release voice / mic resources when the page goes away so HMR cycles and
  // tab closes don't leave orphan setIntervals or a live MediaStream that
  // keeps the browser's "this tab is using your microphone" indicator on.
  // Refs (speaker, recognizer, stopMicTimer) are declared later in this
  // IIFE; the listener fires post-init so resolution is safe.
  const releaseVoiceResources = () => {
    try { if (typeof stopMicTimer === 'function') stopMicTimer(); } catch {}
    try { if (recognizer && typeof recognizer.stop === 'function') recognizer.stop(); } catch {}
    try { if (speaker && typeof speaker.cancel === 'function') speaker.cancel(); } catch {}
  };
  window.addEventListener('pagehide', releaseVoiceResources);

  const loadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.messages)) {
        state.messages = parsed.messages.slice(-MESSAGE_CAP);
      }
      if (typeof parsed.sessionId === 'string') {
        state.sessionId = parsed.sessionId;
      }
      if (typeof parsed.open === 'boolean') {
        state.open = parsed.open;
      }
      if (Array.isArray(parsed.assertions)) {
        state.assertions = parsed.assertions.slice(-100);
      }
      if (typeof parsed.currentAgent === 'string' && parsed.currentAgent) {
        state.currentAgent = parsed.currentAgent;
      }
      // Salvage an interrupted recording: if the last "(recording manual
      // interactions)" user message has no matching done card after it,
      // the user reloaded mid-recording. Synthesize a done card so the
      // session is closeable / saveable / not leaking into the next run.
      let lastRecordingIdx = -1;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i];
        if (m.kind === 'user' && m.text === '(recording manual interactions)') {
          lastRecordingIdx = i;
          break;
        }
      }
      if (lastRecordingIdx >= 0) {
        const hasDoneAfter = state.messages
          .slice(lastRecordingIdx + 1)
          .some((m) => m.kind === 'done' && m.source === 'recording');
        if (!hasDoneAfter) {
          const captured = state.messages
            .slice(lastRecordingIdx + 1)
            .filter((m) => m.kind === 'step').length;
          state.messages.push({
            kind: 'done',
            turns: captured,
            costUsd: 0,
            source: 'recording',
            summary: `Recorded ${captured} action${captured === 1 ? '' : 's'} before reload. Click Save as Skill / Spec on this card to keep it.`,
          });
        }
      }
    } catch {
      /* corrupt — start fresh */
    }
  };

  // ───────────────────────── panel open/close ─────────────────────────
  // Deliberately NO click-outside-to-close: when the agent drives the page,
  // every browser_click would otherwise dismiss the panel. Toggle via the
  // launcher; Esc closes ONLY when focus is inside the shadow root.

  const setOpen = (open) => {
    panel.classList.toggle('open', open);
    launcher.classList.toggle('open', open);
    launcher.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => textarea.focus(), 50);
    state.open = open;
    saveState();
  };
  const isOpen = () => panel.classList.contains('open');

  launcher.addEventListener('click', () => setOpen(!isOpen()));

  // ───────────────────────── voice mode (STT + TTS) ─────────────────────
  // voice.js (concatenated into this IIFE by buildWidgetBundle) exposes
  // detectVoiceSupport / shouldSpeak / detectLanguage / pickVoice /
  // createRecognizer / createSpeaker. We wire them here:
  //
  //   - STT: push-to-talk on the mic button. pointerdown starts recognition,
  //     pointerup stops. Interim transcripts echo into the textarea; the
  //     final transcript triggers submit() so the agent path is unchanged.
  //   - TTS: every InvokeEvent flowing through handleServerEvent is passed
  //     through shouldSpeak(); decisions that say "speak" enqueue an utter-
  //     ance with a voice picked by the text's language (zh/en autodetect).
  //
  // Defaults: TTS on whenever the browser supports it, STT button shown
  // whenever SpeechRecognition is available. Firefox (no SpeechRecognition)
  // sees a disabled mic button with an explanatory tooltip.
  //
  // The push-to-talk button starts the recognizer on pointerdown and stops
  // it on pointerup/leave/cancel. The recognizer's own onend/onerror does
  // the cleanup — never call stop() twice.

  const voiceCaps = detectVoiceSupport();
  if (voiceCaps.stt) {
    micBtn.disabled = false;
  } else {
    micBtn.disabled = true;
    if (voiceCaps.reasons.length > 0) {
      micBtn.setAttribute('data-tooltip', voiceCaps.reasons.join(' · '));
    }
  }

  // langHint tracks the language of the user's most recent prompt (or the
  // recognizer's last STT result). The TTS layer reads this so tool_use /
  // session_end utterances stay in the user's language regardless of what
  // the agent text-replies in (claude / codex commonly answer in English
  // even after a Chinese prompt). Updated by submit() and onFinal().
  let langHint = 'en';

  // Settings persistence — kept in a separate localStorage key from `state`
  // so adding a new toggle doesn't bump the chat-history schema version
  // and wipe everyone's messages. `ttsEnabled` defaults to true to keep
  // first-time experience aligned with what was shipped today.
  const SETTINGS_KEY = 'hover:settings:v1';
  const settings = { ttsEnabled: true, reloadBeforeRecording: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.ttsEnabled === 'boolean') settings.ttsEnabled = parsed.ttsEnabled;
      if (typeof parsed.reloadBeforeRecording === 'boolean') settings.reloadBeforeRecording = parsed.reloadBeforeRecording;
    }
  } catch { /* corrupt / privacy mode */ }
  const saveSettings = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  };

  // Chrome loads voices async — the very first speechSynthesis.getVoices()
  // returns [] and the real list arrives on a voiceschanged event. Without
  // a primer here, the first utterance picks a null voice and the engine
  // reads Chinese text with an English voice. We trigger the wait lazily
  // (after the first WS open) so module-load never touches speechSynthesis —
  // some embedded Chromiums (e.g. the Playwright dogfood runner) crash the
  // renderer when speech APIs are touched at page-load time.
  let voicesPrimed = false;
  const primeVoices = () => {
    if (voicesPrimed || !voiceCaps.tts) return;
    voicesPrimed = true;
    try { waitForVoices(window.speechSynthesis).catch(() => {}); } catch {}
  };

  const speaker = voiceCaps.tts
    ? createSpeaker({
        getVoiceForText: (text) =>
          pickVoice(window.speechSynthesis, detectLanguage(text)),
      })
    : null;

  let listening = false;
  let micTimerId = null;
  let micTimerStartedAt = 0;
  const stopMicTimer = () => {
    if (micTimerId != null) {
      clearInterval(micTimerId);
      micTimerId = null;
    }
    if (micTimerEl) micTimerEl.textContent = '0';
  };
  const startMicTimer = () => {
    stopMicTimer();
    if (!micTimerEl) return;
    micTimerStartedAt = Date.now();
    micTimerEl.textContent = '0';
    // Tick once per second. Render whole seconds — push-to-talk rarely runs
    // longer than ~30s so a 2-digit cap (no MM:SS) keeps the icon clean.
    micTimerId = setInterval(() => {
      const elapsed = Math.floor((Date.now() - micTimerStartedAt) / 1000);
      micTimerEl.textContent = String(elapsed);
    }, 1000);
  };
  const setListening = (on) => {
    listening = on;
    micBtn.classList.toggle('listening', on);
    micBtn.setAttribute('aria-pressed', String(on));
    if (on) startMicTimer();
    else stopMicTimer();
  };

  const recognizer = voiceCaps.stt
    ? createRecognizer({
        onInterim: (text) => {
          // Echo interim transcript into the textarea so the user can
          // see what we're hearing in real time. Final transcript replaces
          // this when isFinal arrives.
          textarea.value = text;
        },
        onFinal: (text) => {
          textarea.value = text;
          setListening(false);
          langHint = detectLanguage(text);
          submit();
        },
        onError: (err) => {
          setListening(false);
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            addMessage({
              kind: 'system',
              text: 'Microphone access denied. Allow it in the browser address bar to use Voice mode.',
            });
          } else if (err !== 'aborted') {
            addMessage({ kind: 'system', text: `Voice error: ${err}` });
          }
        },
        onEnd: () => setListening(false),
      })
    : null;

  if (micBtn && recognizer) {
    micBtn.addEventListener('pointerdown', (e) => {
      if (micBtn.disabled || running) return;
      e.preventDefault();
      // If TTS is in the middle of an utterance, the mic open implies the
      // user wants to talk now — drop the speech queue so we don't have
      // the speaker overlap their voice input.
      speaker?.cancel();
      setListening(true);
      // Hint the recognizer with the last detected reply language if any
      // recent ai text exists in state.messages — otherwise leave the
      // factory default (zh-CN).
      let lastAi = null;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const m = state.messages[i];
        if (m.kind === 'ai' && typeof m.text === 'string') {
          lastAi = m.text;
          break;
        }
      }
      const startLang = lastAi
        ? (detectLanguage(lastAi) === 'zh' ? 'zh-CN' : 'en-US')
        : 'zh-CN';
      recognizer.start(startLang);
    });
    const releaseHandler = () => {
      if (listening) recognizer.stop();
    };
    micBtn.addEventListener('pointerup', releaseHandler);
    micBtn.addEventListener('pointerleave', releaseHandler);
    micBtn.addEventListener('pointercancel', releaseHandler);
  }

  // ───────────────────────── CDP state ─────────────────────────
  // The widget asks the local service "is this Chrome the debug Chrome?" on
  // connect. Three meaningful states:
  //   - 'same-window'  → widget is in the debug Chrome; everything works.
  //   - 'wrong-window' → debug Chrome is running, but in a different process.
  //                       Disable this widget, show "use the other window".
  //   - 'no-cdp'       → no debug Chrome at all. Clicking the action button
  //                       fires launch-chrome on the service.
  // 'launching' is a UI sub-state of 'no-cdp' while the service spawns Chrome.

  let cdpState = 'unknown';
  let cdpLaunching = false;

  const wsOpen = () => ws && ws.readyState === WebSocket.OPEN;

  const sendCheckCdp = () => {
    if (!wsOpen()) return;
    ws.send(JSON.stringify({ type: 'check-cdp', payload: { pageUrl: location.href } }));
  };

  const renderCdpOverlay = () => {
    // Hide overlay entirely when widget is healthy.
    const blocking = cdpState === 'wrong-window' || cdpState === 'no-cdp' || cdpLaunching;
    cdpOverlay.classList.toggle('open', blocking);
    cdpOverlay.setAttribute('aria-hidden', blocking ? 'false' : 'true');
    cdpOverlay.classList.toggle('cdp-launching', cdpLaunching);

    if (cdpLaunching) {
      cdpIconEl.textContent = '⏳';
      cdpTitleEl.textContent = 'Launching debug Chrome…';
      cdpBodyEl.textContent = 'A new Chrome window will open with this URL. Use the widget over there.';
      cdpActionEl.hidden = true;
      return;
    }
    if (cdpState === 'wrong-window') {
      cdpIconEl.textContent = '👉';
      cdpTitleEl.textContent = 'Use the other window';
      cdpBodyEl.textContent = 'A debug Chrome is already running. This widget belongs to your regular Chrome; please switch over.';
      cdpActionEl.hidden = false;
      cdpActionEl.textContent = 'Switch me to it';
      cdpActionEl.dataset.action = 'focus';
      return;
    }
    if (cdpState === 'no-cdp') {
      cdpIconEl.textContent = '🌐';
      cdpTitleEl.textContent = 'No debug Chrome detected';
      cdpBodyEl.textContent = 'Hover needs to drive a Chrome started with the debugging port open. Click below to start one.';
      cdpActionEl.hidden = false;
      cdpActionEl.textContent = 'Launch debug Chrome';
      cdpActionEl.dataset.action = 'launch';
      return;
    }
    // same-window / unknown — overlay hidden; no content update needed.
  };

  const refreshLauncherCdpClass = () => {
    launcher.classList.remove('cdp-wrong-window', 'cdp-no-cdp', 'cdp-launching');
    if (cdpLaunching) launcher.classList.add('cdp-launching');
    else if (cdpState === 'wrong-window') launcher.classList.add('cdp-wrong-window');
    else if (cdpState === 'no-cdp') launcher.classList.add('cdp-no-cdp');
  };

  const applyCdpState = (newState, opts = {}) => {
    cdpState = newState;
    cdpLaunching = !!opts.launching;
    refreshLauncherCdpClass();
    renderCdpOverlay();
    // Keep the textarea/sendBtn in sync with whether we're allowed to drive.
    // When the overlay is up, the underlying input is visually hidden but
    // still focusable — disable it so a stray Enter doesn't dispatch.
    const blocking = cdpState === 'wrong-window' || cdpState === 'no-cdp' || cdpLaunching;
    if (blocking) {
      textarea.disabled = true;
      sendBtn.disabled = true;
    }
  };

  // Wire the overlay's action button (label/data-action change based on state).
  cdpActionEl.addEventListener('click', () => {
    if (!wsOpen()) return;
    const action = cdpActionEl.dataset.action;
    if (action === 'launch') {
      applyCdpState('no-cdp', { launching: true });
      ws.send(JSON.stringify({ type: 'launch-chrome', payload: { pageUrl: location.href } }));
    } else if (action === 'focus') {
      ws.send(JSON.stringify({ type: 'focus-debug', payload: { pageUrl: location.href } }));
    }
  });

  // Esc inside shadow → close. We listen on the shadow root, not document,
  // so a stray Esc on the host page (or AI key input) doesn't dismiss us.
  // If a modal is open it consumes Esc first (handled below).
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalEl.classList.contains('open')) return; // modal handler will close it
    if (isOpen()) setOpen(false);
  });

  // ───────────────────────── modal (prompt / confirm replacement) ─────────────────────────
  //
  // Two flavours, both return a Promise:
  //   hoverPrompt({ title, fields, confirmLabel, cancelLabel, context })
  //     → resolves with { [field.id]: trimmedValue } or null on cancel
  //   hoverConfirm({ title, body, confirmLabel, cancelLabel, danger })
  //     → resolves true on confirm, false on cancel
  //
  // Native window.prompt() / confirm() block the agent's browser_click events
  // (the user's Chrome stops processing input until they dismiss the dialog),
  // and they look out-of-place vs. the rest of the widget. The inline modal
  // lives inside the shadow root and inherits the panel's design language.

  const modalEl = $('.modal');
  const modalTitleEl = $('.modal-title');
  const modalBodyEl = $('.modal-body');
  const modalActionsEl = $('.modal-actions');
  const modalCloseEl = $('.modal-close');
  const modalBackdropEl = $('.modal-backdrop');

  let modalResolve = null;

  const closeModal = (value) => {
    if (!modalResolve) return;
    modalEl.classList.remove('open');
    modalEl.setAttribute('aria-hidden', 'true');
    const r = modalResolve;
    modalResolve = null;
    r(value);
  };

  const openModal = (resolve) => {
    // If a previous modal is somehow still resolving, cancel it.
    if (modalResolve) modalResolve(null);
    modalResolve = resolve;
    modalEl.classList.add('open');
    modalEl.setAttribute('aria-hidden', 'false');
  };

  modalCloseEl.addEventListener('click', () => closeModal(null));
  modalBackdropEl.addEventListener('click', () => closeModal(null));

  // Esc closes the modal (takes precedence over panel-Esc).
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl.classList.contains('open')) {
      e.stopPropagation();
      closeModal(null);
    }
  }, true);

  function hoverPrompt({ title, fields, confirmLabel = 'Save', cancelLabel = 'Cancel', context }) {
    return new Promise((resolve) => {
      modalTitleEl.textContent = title;
      modalBodyEl.innerHTML = '';
      modalActionsEl.innerHTML = '';

      if (context) {
        const ctx = document.createElement('div');
        ctx.className = 'modal-context';
        ctx.textContent = context;
        modalBodyEl.appendChild(ctx);
      }

      const inputs = [];
      for (const f of fields) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-field';
        const lbl = document.createElement('label');
        lbl.textContent = f.label;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.placeholder = f.placeholder ?? '';
        inp.value = f.initial ?? '';
        inp.dataset.fieldId = f.id;
        inp.dataset.required = f.required ? '1' : '0';
        const id = `hover-modal-${f.id}`;
        inp.id = id;
        lbl.htmlFor = id;
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        modalBodyEl.appendChild(wrap);
        inputs.push(inp);
      }

      const submit = () => {
        const out = {};
        for (const inp of inputs) {
          const v = inp.value.trim();
          if (inp.dataset.required === '1' && !v) {
            inp.classList.remove('error');
            void inp.offsetWidth; // re-trigger animation
            inp.classList.add('error');
            inp.focus();
            return;
          }
          out[inp.dataset.fieldId] = v;
        }
        closeModal(out);
      };

      for (const inp of inputs) {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
        inp.addEventListener('input', () => inp.classList.remove('error'));
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'm-ghost';
      cancelBtn.textContent = cancelLabel;
      cancelBtn.addEventListener('click', () => closeModal(null));

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'm-primary';
      confirmBtn.textContent = confirmLabel;
      confirmBtn.addEventListener('click', submit);

      modalActionsEl.appendChild(cancelBtn);
      modalActionsEl.appendChild(confirmBtn);

      openModal(resolve);
      setTimeout(() => inputs[0]?.focus(), 60);
    });
  }

  function hoverConfirm({ title, body, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, context }) {
    return new Promise((resolve) => {
      modalTitleEl.textContent = title;
      modalBodyEl.innerHTML = '';
      modalActionsEl.innerHTML = '';

      if (body) {
        const p = document.createElement('div');
        p.textContent = body;
        modalBodyEl.appendChild(p);
      }
      if (context) {
        const ctx = document.createElement('div');
        ctx.className = 'modal-context';
        ctx.textContent = context;
        modalBodyEl.appendChild(ctx);
      }

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'm-ghost';
      cancelBtn.textContent = cancelLabel;
      cancelBtn.addEventListener('click', () => closeModal(false));

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = danger ? 'm-danger' : 'm-primary';
      confirmBtn.textContent = confirmLabel;
      confirmBtn.addEventListener('click', () => closeModal(true));

      modalActionsEl.appendChild(cancelBtn);
      modalActionsEl.appendChild(confirmBtn);

      openModal(resolve);
      setTimeout(() => confirmBtn.focus(), 60);
    });
  }

  // ───────────────────────── rendering ─────────────────────────

  const scrollToBottom = () => {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };

  // Minimal markdown renderer: bold, italic, inline code. Escapes HTML first
  // so AI-controlled text can never inject markup; then applies the three
  // patterns. Anything else (lists, links, headings) renders as-is — fine,
  // since the AI bubble is short prose.
  const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const renderMarkdownLite = (text) =>
    escapeHtml(text)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Truncate JSON-like input args for the expanded tool-call lines.
  const shortJson = (input) => {
    const s = JSON.stringify(input ?? {});
    return s.length > 90 ? s.slice(0, 87) + '…' : s;
  };

  const formatCost = (usd) => (usd == null ? '' : `$${usd.toFixed(4)}`);
  const formatTurns = (n) => (n == null ? '' : `${n} turn${n === 1 ? '' : 's'}`);
  // Human-friendly elapsed time. <60s → "1.1s" (one decimal, floored to 0.1s so
  // a freshly opened group doesn't blink "0.0s"); ≥60s → "1m 23s".
  const formatDuration = (ms) => {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
    const sec = ms / 1000;
    if (sec < 60) return `${Math.max(0.1, sec).toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s}s`;
  };

  const renderUserRow = (text) => {
    const div = document.createElement('div');
    div.className = 'msg user';
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    div.appendChild(b);
    return div;
  };

  const renderSystemRow = (text) => {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    return div;
  };

  const renderAiRow = (text) => {
    const div = document.createElement('div');
    div.className = 'msg ai';
    const b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = renderMarkdownLite(text);
    div.appendChild(b);
    return div;
  };

  // Render a grouped step row — Midscene-style: one row per natural-language
  // intent. Click anywhere on the row to toggle the tool-call detail
  // disclosure. The currently-running group auto-expands so the user sees
  // tool calls in real time; finished groups default to collapsed.
  // Report card — the agent's natural-language verification report at the
  // end of a session. Plain-text body (markdown stripped) so headings and
  // bullets don't show literal "##" / "-" characters. Only this card hosts
  // the Save-as dropdown — that's the primary action after a successful
  // run, and tying it to the report (rather than the last step) makes the
  // intent obvious.
  const renderReport = (g) => {
    const root = document.createElement('div');
    // Variant precedence: cancelled (user Stop) > error (agent failure)
    //                     > ok. Keeps the user-initiated stop visually
    // distinct from a real failure even if some downstream caller sets
    // both flags simultaneously.
    const variant = g.cancelled ? 'cancelled' : g.isError ? 'error' : 'ok';
    root.className = 'report ' + variant;

    const header = document.createElement('div');
    header.className = 'report-header';
    const icon = document.createElement('span');
    icon.className = 'report-header-icon';
    icon.textContent = variant === 'cancelled' ? '⊘' : variant === 'error' ? '✗' : '✓';
    const label = document.createElement('span');
    label.className = 'report-header-label';
    label.textContent = variant === 'cancelled' ? 'Stopped' : variant === 'error' ? 'Failed' : 'Result';
    const meta = document.createElement('span');
    meta.className = 'report-header-meta';
    const parts = [];
    if (g.turns != null) parts.push(`${g.turns} turn${g.turns === 1 ? '' : 's'}`);
    if (g.costUsd != null) parts.push(`$${g.costUsd.toFixed(4)}`);
    meta.textContent = parts.join(' · ');
    header.appendChild(icon);
    header.appendChild(label);
    header.appendChild(meta);
    root.appendChild(header);

    if (g.text) {
      const body = document.createElement('div');
      body.className = 'report-body';
      // Plain text → preserve newlines but DON'T render markdown.
      body.textContent = g.text;
      root.appendChild(body);
    }

    if (g.saveable) {
      const actions = document.createElement('div');
      actions.className = 'report-actions';
      actions.appendChild(buildSaveDropdown(g.source));
      root.appendChild(actions);
    }

    return root;
  };

  // Findings card — dedicated visual for "the agent's bug report at the end
  // of a run". Sits separate from the conversation timeline so it doesn't
  // get lost in the step list. Bugs / minor severities each get their own
  // colour-coded row.
  const renderFindings = (g) => {
    const root = document.createElement('div');
    root.className = 'findings';

    const header = document.createElement('div');
    header.className = 'findings-header';
    const icon = document.createElement('span');
    icon.className = 'findings-header-icon';
    icon.textContent = '!';
    const label = document.createElement('span');
    label.className = 'findings-header-label';
    label.textContent = 'Findings';
    const count = document.createElement('span');
    count.className = 'findings-header-count';
    count.textContent = String(g.findings.length);
    header.appendChild(icon);
    header.appendChild(label);
    header.appendChild(count);
    root.appendChild(header);

    const list = document.createElement('div');
    list.className = 'findings-list';
    for (const f of g.findings) {
      const row = document.createElement('div');
      row.className = 'finding-row finding-' + f.severity;
      const sev = document.createElement('span');
      sev.className = 'finding-severity';
      sev.textContent = f.marker || (f.severity === 'bug' ? 'Bug' : f.severity === 'minor' ? 'Minor' : 'Note');
      const txt = document.createElement('span');
      txt.className = 'finding-text';
      txt.innerHTML = renderMarkdownLite(f.text);
      row.appendChild(sev);
      row.appendChild(txt);
      list.appendChild(row);
    }
    root.appendChild(list);
    return root;
  };

  const renderGroup = (g, isLastGroup, isLiveRun) => {
    const root = document.createElement('div');
    root.className = 'group ' + g.status;
    // No auto-expand — even the running group stays collapsed. The user
    // chooses when to drill in. This keeps the timeline scannable; details
    // are one click away.

    const row = document.createElement('div');
    row.className = 'group-row';

    const chevron = document.createElement('span');
    chevron.className = 'gr-chevron';
    chevron.textContent = '▶';

    // Status indicator:
    //   running   → outlined ring (mint pulse via CSS)
    //   error     → red ✗ (agent / runtime failure)
    //   cancelled → grey ⊘ (user pressed Stop)
    //   ok        → green ✓
    const icon = document.createElement('span');
    icon.className = 'gr-icon';
    if (g.status === 'running') {
      icon.classList.add('gr-ring');
    } else if (g.status === 'error') {
      icon.textContent = '✗';
    } else if (g.status === 'cancelled') {
      icon.textContent = '⊘';
    } else {
      icon.textContent = '✓';
    }

    const title = document.createElement('span');
    title.className = 'gr-title';
    title.textContent = g.title;

    row.appendChild(chevron);
    row.appendChild(icon);
    row.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'gr-meta';
    // Per-group cost is the diff between the cost snapshot taken at the last
    // step and the one taken at the first step. Both snapshots are stamped
    // by the agent layer (claude.ts / codex.ts) onto tool_use events so the
    // group can attribute LLM spend to the natural-language intent that drove
    // those tools. Falsy diff (≤0 or unknown) → omit the cost piece.
    const costDiff =
      g.costEndUsd != null && g.costStartUsd != null
        ? g.costEndUsd - g.costStartUsd
        : null;
    const isRunning = g.status === 'running';
    const endTime = isRunning ? Date.now() : g.endedAt;
    const durationMs =
      g.startedAt != null && endTime != null ? endTime - g.startedAt : null;
    const parts = [];
    if (durationMs != null) parts.push(formatDuration(durationMs));
    if (!isRunning && costDiff != null && costDiff > 0) {
      parts.push(`<span class="gr-cost">${formatCost(costDiff)}</span>`);
    }
    // Fallback for groups that predate the cost-snapshot wiring (older
    // localStorage state) — keep the original step-count meta so they don't
    // render blank.
    if (parts.length === 0 && g.steps && g.steps.length > 0) {
      parts.push(`${g.steps.length} step${g.steps.length === 1 ? '' : 's'}`);
    }
    if (parts.length) meta.innerHTML = parts.join(' · ');
    if (isRunning && g.startedAt != null) {
      meta.setAttribute('data-running-meta', '1');
      meta.setAttribute('data-started-at', String(g.startedAt));
    }
    row.appendChild(meta);

    row.addEventListener('click', () => {
      root.classList.toggle('open');
    });

    root.appendChild(row);

    if (g.steps && g.steps.length > 0) {
      const tools = document.createElement('div');
      tools.className = 'group-tools';
      for (const s of g.steps) {
        const line = document.createElement('div');
        line.className = 'group-tool' + (s.isError ? ' error' : '');
        const dot = document.createElement('span');
        dot.className = 'gt-dot'; dot.textContent = '·';
        const name = document.createElement('span');
        name.className = 'gt-name'; name.textContent = s.tool;
        const args = document.createElement('span');
        args.className = 'gt-args'; args.textContent = ' ' + shortJson(s.input);
        line.appendChild(dot);
        line.appendChild(name);
        line.appendChild(args);
        tools.appendChild(line);
      }
      root.appendChild(tools);
    }

    // Note: closed groups used to render a summary line + Save-as chip
    // here. Both moved to the dedicated `renderReport` card emitted by
    // the reducer's done branch. Steps are pure now: row + collapsed
    // tool detail, nothing else.

    return root;
  };

  // Full re-render from state.messages. Cheap enough for the message volumes
  // we expect (a single session is rarely more than ~80 raw messages even on
  // long flows). If we ever hit the MESSAGE_CAP limit and re-render starts to
  // jank, switch to incremental DOM diffing — but premature.
  //
  // To support the "new message fades in" animation without re-animating
  // every existing message on every renderAll(), we track how many groups
  // we rendered last time. Anything beyond that index is a fresh arrival
  // and gets `data-fresh="1"`, which the CSS keyframe targets.
  let lastRenderedGroupCount = 0;
  const renderAll = () => {
    const wasAtBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 80;
    bodyEl.innerHTML = '';
    const groups = groupMessages(state.messages, running);
    const previousCount = lastRenderedGroupCount;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const isLast = i === groups.length - 1;
      let node;
      if (g.kind === 'user') node = renderUserRow(g.text);
      else if (g.kind === 'system') node = renderSystemRow(g.text);
      else if (g.kind === 'ai') node = renderAiRow(g.text);
      else if (g.kind === 'group') node = renderGroup(g, isLast, running);
      else if (g.kind === 'report') node = renderReport(g);
      else if (g.kind === 'findings') node = renderFindings(g);
      if (node) {
        if (i >= previousCount) node.setAttribute('data-fresh', '1');
        bodyEl.appendChild(node);
      }
    }
    lastRenderedGroupCount = groups.length;
    if (wasAtBottom) scrollToBottom();
  };

  // Tick the running group's elapsed-time readout once per second. We patch
  // only the meta span in place rather than calling renderAll() so the DOM
  // stays stable (no flicker, no scroll thrash, no re-animation of fresh
  // rows). The meta span is marked with `data-running-meta` only when the
  // group is in 'running' state — finishing the group removes the attribute
  // on the next renderAll, which stops the tick from touching it again.
  setInterval(() => {
    if (!running) return;
    const node = bodyEl.querySelector('[data-running-meta="1"]');
    if (!node) return;
    const startedAt = Number(node.getAttribute('data-started-at'));
    if (!Number.isFinite(startedAt)) return;
    node.innerHTML = formatDuration(Date.now() - startedAt);
  }, 1000);

  // Reset the freshness tracker when the conversation is cleared so the
  // first re-render after "+" doesn't think everything is brand new.
  // (Replay from localStorage on boot intentionally animates the restored
  // messages once — feels like the panel "wakes up".)

  // rAF-coalesced renderAll for hot paths. A streaming tool_use burst (10
  // tools in 200ms) used to fire 10 full DOM rebuilds back-to-back — wasted
  // work since only the last frame's state is what the user sees. With this
  // we collapse to at most one render per animation frame; the human-visible
  // result is identical (still ~60Hz) but the synchronous work between WS
  // events drops to near-zero, keeping the main thread free for scroll/input.
  let renderRafPending = false;
  const scheduleRender = () => {
    if (renderRafPending) return;
    renderRafPending = true;
    requestAnimationFrame(() => {
      renderRafPending = false;
      renderAll();
    });
  };

  // Append a serialized message: push to state + persist + re-render.
  const addMessage = (msg) => {
    state.messages.push(msg);
    if (state.messages.length > MESSAGE_CAP) state.messages.shift();
    scheduleSaveState();
    scheduleRender();
  };

  // Restore all stored messages on init.
  const replayState = () => {
    renderAll();
  };

  // ───────────────────────── save dropdown ─────────────────────────
  //
  // One trigger button per done card; the menu lists the three artifact
  // formats. Each menu item delegates to the same save* function that
  // used to be wired to its own button, passing the trigger so the
  // Saving…/restore flow has something to update.

  // Single-stroke inline SVGs that inherit currentColor — same vocabulary
  // as the header icons. Defined once at the top of the dropdown so swapping
  // visual treatment later is a one-line edit per glyph.
  const SAVE_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h7l3 3v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M4 3v3.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5V3"/><path d="M4 13v-3.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5V13"/></svg>';
  const SPEC_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2h5l3 3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M9 2v3h3"/><path d="M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3"/></svg>';
  const CSV_ICON_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 6.5h11M2.5 9.5h11M6 6.5v6.5M10 6.5v6.5"/></svg>';
  const CARET_DOWN_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5l3 3 3-3"/></svg>';

  const TRIGGER_LABEL_HTML = `<span class="trigger-icon">${SAVE_ICON_SVG}</span><span class="trigger-label">Save as</span><span class="caret">${CARET_DOWN_SVG}</span>`;

  const restoreTrigger = (b) => {
    b.disabled = false;
    b.innerHTML = TRIGGER_LABEL_HTML;
  };

  function buildSaveDropdown(source) {
    const wrap = document.createElement('div');
    wrap.className = 'save-wrap';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'save-trigger';
    trigger.innerHTML = TRIGGER_LABEL_HTML;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'save-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    // Jira test-case CSV is the agent-Findings → Xray/Zephyr export path:
    // it bakes the agent's natural-language summary, findings, and step list
    // into a test-management import format. Manually recorded sessions
    // produce no summary or findings (the user just clicked through a UI),
    // so the resulting CSV would be empty of useful test-design fields —
    // hide the item to avoid suggesting an artifact that won't be useful.
    const allItems = [
      {
        icon: SPEC_ICON_SVG, label: 'Playwright spec',
        sub: '__vibe_tests__/<slug>.spec.ts · for CI',
        cls: 'item-spec',
        run: () => saveAsArtifact('spec', trigger),
      },
      {
        icon: SAVE_ICON_SVG, label: 'Claude Code Skill',
        sub: '.claude/skills/<slug>/SKILL.md · for future agent replay',
        cls: 'item-skill',
        run: () => saveAsArtifact('skill', trigger),
      },
      {
        icon: CSV_ICON_SVG, label: 'Jira test case (CSV)',
        sub: '__vibe_tests__/<slug>.case.csv · for Xray / Zephyr / Jira',
        cls: 'item-case',
        run: () => saveAsArtifact('case-csv', trigger),
        agentOnly: true,
      },
    ];
    const items = source === 'recording'
      ? allItems.filter((it) => !it.agentOnly)
      : allItems;
    // v0.12 — plugin-contributed save entries are appended after the
    // core save items. Only the active plugin mode's entries are
    // returned by hostCtl.getActiveSaveEntries(); when no plugin mode
    // is engaged, this is an empty list and the dropdown looks
    // identical to v0.11.
    const pluginEntries = typeof hostCtl.getActiveSaveEntries === 'function'
      ? hostCtl.getActiveSaveEntries()
      : [];
    for (const e of pluginEntries) {
      items.push({
        icon: e.icon || SAVE_ICON_SVG,
        label: e.label,
        sub: e.sub,
        cls: 'item-plugin',
        run: () => saveAsPluginArtifact(e, trigger),
      });
    }
    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'save-menu-item ' + it.cls;
      btn.setAttribute('role', 'menuitem');
      const icon = document.createElement('span');
      icon.className = 'i-icon'; icon.innerHTML = it.icon;
      const text = document.createElement('span'); text.className = 'i-text';
      const label = document.createElement('span'); label.className = 'i-label'; label.textContent = it.label;
      const sub = document.createElement('span'); sub.className = 'i-sub'; sub.textContent = it.sub;
      text.appendChild(label); text.appendChild(sub);
      btn.appendChild(icon); btn.appendChild(text);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        it.run();
      });
      menu.appendChild(btn);
    }

    const closeOnOutside = (e) => {
      if (!e.composedPath().includes(wrap)) closeMenu();
    };
    const closeOnEsc = (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        e.stopPropagation();
        closeMenu();
      }
    };
    let attachTimer = null;
    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      // Listeners attached on next tick so the click that opened the
      // menu doesn't immediately bubble to closeOnOutside. Track the
      // pending timer so a closeMenu() inside the same tick cancels it
      // — otherwise the listeners attach after close and leak.
      attachTimer = setTimeout(() => {
        attachTimer = null;
        document.addEventListener('click', closeOnOutside, { capture: true });
        root.addEventListener('keydown', closeOnEsc, { capture: true });
      }, 0);
    }
    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (attachTimer != null) {
        clearTimeout(attachTimer);
        attachTimer = null;
      }
      document.removeEventListener('click', closeOnOutside, { capture: true });
      root.removeEventListener('keydown', closeOnEsc, { capture: true });
    }
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
  }

  // ───────────────────────── save as skill ─────────────────────────

  // Pluck the most recent session out of state.messages: everything from the
  // last user message to the end. Used as the payload of {type:'save-skill'}.
  const lastSessionSlice = () => {
    let idx = -1;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].kind === 'user') { idx = i; break; }
    }
    return idx === -1 ? state.messages.slice() : state.messages.slice(idx);
  };

  // Pending save state — remembered so a confirm-overwrite reply can re-send
  // with overwrite=true without re-prompting the user for name/description.
  // Two slots, one per output format (skill vs spec).
  // ───── save-as-artifact flow (skill / spec / jira case CSV) ─────
  //
  // All three save flows share the same shape: confirm a name+description
  // in a modal, send a save-X request, await save-X-saved / save-X-exists,
  // optionally re-prompt for overwrite on exists, on success surface a
  // system message + restore the trigger button. The ARTIFACTS table holds
  // the per-kind differences (modal fields, WS message names, success text,
  // optional pre/post hooks); `saveAsArtifact` and `handleArtifactExists`
  // are the two shared helpers.
  const pending = new Map();   // kind -> { name, description, steps, assertions, button, extras }

  const ARTIFACTS = {
    skill: {
      saveType: 'save-skill',
      existsType: 'skill-exists',
      savedType: 'skill-saved',
      promptOpts: () => ({
        title: 'Save as Skill',
        fields: [
          { id: 'name', label: 'Skill name', placeholder: 'login-as-claude', required: true },
          { id: 'description', label: 'Description', placeholder: 'optional · one line' },
        ],
        confirmLabel: 'Save skill',
      }),
      buildPayload: (form, ctx) => ({
        name: form.name,
        description: form.description,
        steps: ctx.steps,
      }),
      successMsg: (p) =>
        `✓ saved skill "${p.name}" → ${p.path}\n  try: "execute ${p.name}" in a new conversation`,
      overwriteOpts: (slug) => ({
        title: 'Overwrite existing skill?',
        body: `A skill named "${slug}" already exists.`,
      }),
    },
    spec: {
      saveType: 'save-spec',
      existsType: 'spec-exists',
      savedType: 'spec-saved',
      promptOpts: (ctx) => ({
        title: 'Save as Playwright spec',
        fields: [
          { id: 'name', label: 'Spec name', placeholder: 'login-flow', required: true },
          { id: 'description', label: 'Description', placeholder: 'optional · one line' },
        ],
        context: ctx.assertions.length > 0
          ? `+ ${ctx.assertions.length} pending assertion${ctx.assertions.length === 1 ? '' : 's'} will be baked in`
          : undefined,
        confirmLabel: 'Save spec',
      }),
      buildPayload: (form, ctx) => ({
        name: form.name,
        description: form.description,
        steps: ctx.steps,
        assertions: ctx.assertions,
      }),
      successMsg: (p, entry) => {
        const n = entry?.assertions?.length ?? 0;
        const tail = n > 0 ? ` (+${n} assertion${n === 1 ? '' : 's'})` : '';
        return `✓ saved Playwright spec "${p.name}"${tail} → ${p.path}\n  run it: pnpm test:e2e`;
      },
      overwriteOpts: (slug) => ({
        title: 'Overwrite existing spec?',
        body: `A Playwright spec named "${slug}" already exists.`,
      }),
      // After a successful spec save, the assertions are baked into the
      // file — clear them from the live widget state so the next session
      // doesn't accidentally re-emit them.
      onSuccess: () => {
        state.assertions = [];
        saveState();
        updateAssertBadge();
      },
    },
    'case-csv': {
      saveType: 'save-case-csv',
      existsType: 'case-csv-exists',
      savedType: 'case-csv-saved',
      promptOpts: (ctx) => ({
        title: 'Save as Jira test case (Xray CSV)',
        fields: [
          { id: 'name', label: 'Test case name', placeholder: 'login-flow', required: true },
          { id: 'description', label: 'Summary', placeholder: 'optional · used as the test case Summary in Jira' },
          { id: 'jiraProjectKey', label: 'Jira project key', placeholder: 'optional · e.g. PROJ — added as a label' },
          { id: 'labels', label: 'Labels', placeholder: 'optional · space- or comma-separated' },
        ],
        context: ctx.assertions.length > 0
          ? `+ ${ctx.assertions.length} pending assertion${ctx.assertions.length === 1 ? '' : 's'} will become the Expected Result`
          : 'Imports into Xray, Zephyr Scale, or the generic Jira issue importer.',
        confirmLabel: 'Save Jira case',
      }),
      buildPayload: (form, ctx) => ({
        name: form.name,
        description: form.description,
        jiraProjectKey: form.jiraProjectKey,
        labels: form.labels,
        steps: ctx.steps,
        assertions: ctx.assertions,
      }),
      successMsg: (p) =>
        `✓ saved Jira test case "${p.name}" → ${p.path}\n  import via Xray Test Case Importer · or Zephyr Scale · or Jira issue importer (CSV).`,
      overwriteOpts: (slug) => ({
        title: 'Overwrite existing Jira case CSV?',
        body: `A test case CSV named "${slug}" already exists.`,
      }),
    },
  };

  // Plugin Save entries register their pending state here so the core
  // onmessage handler (below) can route `<type>:saved` responses back to
  // the right trigger button. Mirrors the `pending` map used by core save
  // artifacts but keyed by the WS save type so multiple plugins co-exist.
  const pendingPluginSaves = new Map(); // type -> { button, entry }

  /**
   * Plugin-contributed Save entry runner (v0.12). Mirrors saveAsArtifact's
   * shape — prompt for fields, send a WS message keyed by the plugin's
   * `save:<plugin>:<kind>` type, await the matching `<type>:saved`
   * response. The service dispatches to the plugin's handler.
   *
   * Unlike core save flows, we DO NOT include `steps` / `assertions` in
   * the payload. Plugin handlers read whatever state they need server-
   * side (e.g. security checks live in the control plane closure) — the
   * widget just passes the prompt-form fields.
   */
  const saveAsPluginArtifact = async (entry, button) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }
    const form = await hoverPrompt({
      title: entry.title || entry.label,
      fields: entry.fields,
      confirmLabel: entry.confirmLabel,
    });
    if (!form) return;
    button.disabled = true;
    button.textContent = 'Saving…';
    pendingPluginSaves.set(entry.type, { button, entry, formName: form.name });
    ws.send(JSON.stringify({
      type: entry.type,
      payload: form,
    }));
    // Failsafe: re-enable trigger if no response within 15s.
    setTimeout(() => {
      const p = pendingPluginSaves.get(entry.type);
      if (p && p.button.textContent === 'Saving…') {
        restoreTrigger(p.button);
        pendingPluginSaves.delete(entry.type);
      }
    }, 15000);
  };

  /**
   * Called from the core onmessage handler when a `<type>:saved` arrives.
   * Returns true when this message was a plugin save response (so the
   * core handler knows to stop processing).
   */
  const tryHandlePluginSave = (msg) => {
    if (typeof msg.type !== 'string') return false;
    if (msg.type.endsWith(':saved')) {
      const saveType = msg.type.slice(0, -':saved'.length);
      const p = pendingPluginSaves.get(saveType);
      if (!p) return false;
      pendingPluginSaves.delete(saveType);
      restoreTrigger(p.button);
      const text = (p.entry.successMsgTemplate || '✓ saved "{name}" → {path}')
        .replace('{name}', msg.payload?.name ?? p.formName)
        .replace('{path}', msg.payload?.path ?? '');
      addMessage({ kind: 'system', text });
      return true;
    }
    // Plugin-side errors come back as { type: 'error', payload: {
    // message: '<saveType>: <real reason>' } }. We claim the error if
    // any pending plugin save's type prefix matches the message — gives
    // each plugin a clean error path without forcing the service to
    // emit `<type>:error` separately.
    if (msg.type === 'error' && typeof msg.payload?.message === 'string') {
      for (const [type, p] of pendingPluginSaves) {
        if (msg.payload.message.startsWith(type)) {
          pendingPluginSaves.delete(type);
          restoreTrigger(p.button);
          addMessage({ kind: 'system', text: `✗ ${msg.payload.message}` });
          return true;
        }
      }
    }
    return false;
  };

  const saveAsArtifact = async (kind, button) => {
    const cfg = ARTIFACTS[kind];
    if (!cfg) return;

    const steps = lastSessionSlice();
    if (steps.length === 0 || !steps.some((s) => s.kind === 'step')) {
      addMessage({ kind: 'system', text: 'Nothing to save (no tool steps in the last session).' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }

    const ctx = { steps, assertions: state.assertions.slice() };
    const form = await hoverPrompt(cfg.promptOpts(ctx));
    if (!form) return;

    const entry = { ...form, ...ctx, button };
    pending.set(kind, entry);

    button.disabled = true;
    button.textContent = 'Saving…';
    ws.send(JSON.stringify({ type: cfg.saveType, payload: cfg.buildPayload(form, ctx) }));

    // Failsafe: if no reply within 8s (server crashed mid-write, network
    // dropped, etc.) re-enable the trigger so the user isn't stuck.
    setTimeout(() => {
      if (button.textContent === 'Saving…') restoreTrigger(button);
    }, 8000);
  };

  const handleArtifactExists = async (kind, slug, existingPath) => {
    const cfg = ARTIFACTS[kind];
    const entry = pending.get(kind);
    if (!cfg || !entry) return;
    const overwrite = await hoverConfirm({
      ...cfg.overwriteOpts(slug),
      context: existingPath,
      confirmLabel: 'Overwrite',
      danger: true,
    });
    if (overwrite) {
      ws.send(JSON.stringify({
        type: cfg.saveType,
        payload: { ...cfg.buildPayload(entry, entry), overwrite: true },
      }));
      return;
    }
    if (entry.button) restoreTrigger(entry.button);
    addMessage({ kind: 'system', text: `Skipped overwrite of "${slug}".` });
    pending.delete(kind);
  };

  const handleArtifactSaved = (kind, payload) => {
    const cfg = ARTIFACTS[kind];
    if (!cfg) return;
    const entry = pending.get(kind);
    addMessage({ kind: 'system', text: cfg.successMsg(payload, entry) });
    // Re-arm any "Saving…" save-trigger in the panel. Only one should ever
    // be live at a time, but the selector is defensive.
    root.querySelectorAll('.save-trigger').forEach((b) => {
      if (b.textContent.includes('Saving')) restoreTrigger(b);
    });
    cfg.onSuccess?.(entry);
    pending.delete(kind);
  };

  // ───────────────────────── saved-sessions overlay ─────────────────────────
  //
  // The overlay carries two tabs:
  //   • Skills — replayable agent instructions. Self-adapting (agent
  //     re-resolves selectors each run), so they're "list, click to
  //     replay, no maintenance" surface.
  //   • Specs — Playwright tests under __vibe_tests__/. CI runs them
  //     pure, no AI. v0.11 adds a [⟳ Re-record] action per spec — the
  //     agent replays the original prompt on the current UI and
  //     overwrites the file.

  const requestSkillsList = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'list-skills' }));
    }
  };

  const requestSpecsList = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'list-specs' }));
    }
  };

  const renderSkills = (skills) => {
    skillsCountEl.textContent = String(skills.length);
    skillsListEl.innerHTML = '';
    if (skills.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'skills-empty';
      empty.textContent = 'No saved skills yet. Run a session, then click "Save as → Claude Code Skill" on the result card.';
      skillsListEl.appendChild(empty);
      return;
    }
    for (const s of skills) {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const n = document.createElement('div');
      n.className = 'skill-name';
      n.textContent = s.name || s.slug;
      const d = document.createElement('div');
      d.className = 'skill-desc';
      d.textContent = s.description || '(no description)';
      const slug = document.createElement('div');
      slug.className = 'skill-slug';
      slug.textContent = s.slug;
      row.appendChild(n);
      row.appendChild(d);
      row.appendChild(slug);
      row.addEventListener('click', () => executeSkill(s));
      skillsListEl.appendChild(row);
    }
  };

  const executeSkill = (skill) => {
    if (running || !ws || ws.readyState !== WebSocket.OPEN) return;
    closeSkillsOverlay();
    // Phrased to nudge the agent toward the Skill tool with the exact slug,
    // not toward parsing the verb "execute" as a skill name (which we
    // observed in 2.1.145).
    const prompt =
      `Use the Skill tool to invoke the skill named "${skill.slug}". ` +
      `It is in ${skill.path}. Read its replay steps and run them with ` +
      `mcp__playwright tools. Do not search for the file yourself.`;
    addMessage({ kind: 'user', text: `execute "${skill.slug}"` });
    setRunning(true);
    ws.send(JSON.stringify({
      type: 'command',
      payload: { text: prompt, sessionId: state.sessionId ?? undefined },
    }));
  };

  // F7 optimization-pass UI state: the spec currently being optimized + the
  // last specs list (so async optimize-result can re-render the overlay).
  let optimizing = null;
  let lastSpecs = [];

  const renderSpecs = (specs) => {
    lastSpecs = specs;
    if (!specsListEl || !specsCountEl) return;
    specsCountEl.textContent = String(specs.length);
    specsListEl.innerHTML = '';
    if (specs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'skills-empty';
      empty.textContent = 'No saved specs yet. Run a session, then click "Save as → Playwright spec" on the result card.';
      specsListEl.appendChild(empty);
      return;
    }
    const fmtRelative = (ms) => {
      const diff = Date.now() - ms;
      const min = Math.floor(diff / 60_000);
      if (min < 1) return 'just now';
      if (min < 60) return `${min}m ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ago`;
      const d = Math.floor(hr / 24);
      return `${d}d ago`;
    };
    for (const s of specs) {
      const row = document.createElement('div');
      row.className = 'skill-row spec-row';
      const n = document.createElement('div');
      n.className = 'skill-name';
      n.textContent = s.slug;
      const d = document.createElement('div');
      d.className = 'skill-desc';
      d.textContent = s.originalPrompt
        ? s.originalPrompt
        : '(hand-authored — no Original prompt header; cannot re-record)';
      const meta = document.createElement('div');
      meta.className = 'skill-slug';
      meta.textContent = fmtRelative(s.mtimeMs);
      row.appendChild(n);
      row.appendChild(d);
      row.appendChild(meta);
      // Re-record + Optimize live in one dropdown so they don't fight over the
      // single grid cell (grid-column 2 / row 1-4).
      row.appendChild(buildSpecActions(s));
      specsListEl.appendChild(row);

      // Inline candidate review when a result is ready for this spec.
      if (optimizing && optimizing.slug === s.slug && optimizing.status === 'ready') {
        specsListEl.appendChild(buildOptimizeReview(s.slug));
      }
    }
  };

  // One dropdown per spec row: ⟳ Re-record + Optimize. Occupies the grid cell
  // the lone re-record button used to (grid-column 2 / grid-row 1-4); the menu
  // pops below the trigger. Toggle/close-on-outside mirror buildSaveDropdown.
  const buildSpecActions = (s) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'grid-column:2;grid-row:1 / 4;align-self:center;position:relative;';
    const busy = optimizing && optimizing.slug === s.slug && optimizing.status === 'running';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'spec-rerecord-btn';
    trigger.style.cssText = 'position:static;'; // grid props don't apply inside wrap
    trigger.textContent = busy ? 'Optimizing…' : 'Actions ▾';
    trigger.disabled = busy;

    const menu = document.createElement('div');
    menu.hidden = true;
    menu.style.cssText =
      'position:absolute;right:0;top:calc(100% + 4px);z-index:30;min-width:150px;' +
      'background:var(--bg-2);border:1px solid var(--line);border-radius:6px;padding:4px;' +
      'display:flex;flex-direction:column;gap:2px;box-shadow:0 6px 20px rgba(0,0,0,0.45);';

    const mkItem = (label, opts) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText =
        'text-align:left;padding:6px 9px;background:none;border:none;color:var(--text-mute);' +
        'font:inherit;font-size:11px;border-radius:4px;cursor:pointer;white-space:nowrap;';
      if (opts.disabled) {
        b.disabled = true;
        b.style.opacity = '0.4';
        b.style.cursor = 'not-allowed';
        if (opts.tip) b.setAttribute('data-tooltip', opts.tip);
      } else {
        b.addEventListener('mouseenter', () => { b.style.background = 'var(--accent-dim)'; b.style.color = 'var(--accent)'; });
        b.addEventListener('mouseleave', () => { b.style.background = 'none'; b.style.color = 'var(--text-mute)'; });
        b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); opts.run(); });
      }
      return b;
    };

    menu.appendChild(
      s.originalPrompt
        ? mkItem('⟳ Re-record', { run: () => reRecordSpec(s) })
        : mkItem('⟳ Re-record', { disabled: true, tip: 'No Original prompt header — cannot re-record' }),
    );
    menu.appendChild(mkItem('Optimize', { run: () => optimizeSpecAction(s) }));

    const closeOnOutside = (e) => { if (!e.composedPath().includes(wrap)) closeMenu(); };
    let attachTimer = null;
    function openMenu() {
      menu.hidden = false;
      attachTimer = setTimeout(() => {
        attachTimer = null;
        document.addEventListener('click', closeOnOutside, { capture: true });
      }, 0);
    }
    function closeMenu() {
      menu.hidden = true;
      if (attachTimer != null) { clearTimeout(attachTimer); attachTimer = null; }
      document.removeEventListener('click', closeOnOutside, { capture: true });
    }
    if (!busy) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.hidden) openMenu();
        else closeMenu();
      });
    }

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
  };

  const buildOptimizeReview = (slug) => {
    const panel = document.createElement('div');
    panel.style.cssText =
      'margin:4px 0 12px;padding:8px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:6px;background:rgba(255,255,255,0.03);';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;opacity:0.7;margin-bottom:6px;';
    label.textContent = 'Optimized candidate — original kept until you accept:';
    const pre = document.createElement('pre');
    pre.style.cssText =
      'max-height:200px;overflow:auto;font-size:11px;line-height:1.45;white-space:pre-wrap;margin:0 0 8px;';
    pre.textContent = optimizing.candidate || '';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'spec-rerecord-btn';
    use.style.cssText = 'flex:1;';
    use.textContent = '✓ Use optimized';
    use.addEventListener('click', () => promoteOptimizeAction(slug));
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'spec-rerecord-btn';
    keep.style.cssText = 'flex:1;';
    keep.textContent = '✗ Keep original';
    keep.addEventListener('click', () => discardOptimizeAction(slug));
    actions.appendChild(use);
    actions.appendChild(keep);
    panel.appendChild(label);
    panel.appendChild(pre);
    panel.appendChild(actions);
    return panel;
  };

  const optimizeSpecAction = (spec) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot optimize: service disconnected.' });
      return;
    }
    optimizing = { slug: spec.slug, status: 'running' };
    renderSpecs(lastSpecs);
    ws.send(JSON.stringify({ type: 'optimize-spec', payload: { slug: spec.slug } }));
  };

  const promoteOptimizeAction = (slug) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'promote-optimized', payload: { slug } }));
    }
    optimizing = null;
    renderSpecs(lastSpecs);
  };

  const discardOptimizeAction = (slug) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'discard-optimized', payload: { slug } }));
    }
    optimizing = null;
    renderSpecs(lastSpecs);
  };

  const reRecordSpec = (spec) => {
    if (running || !ws || ws.readyState !== WebSocket.OPEN || !spec.originalPrompt) return;
    closeSkillsOverlay();
    addMessage({ kind: 'user', text: `re-record "${spec.slug}": ${spec.originalPrompt}` });
    setRunning(true);
    ws.send(JSON.stringify({
      type: 'command',
      payload: {
        text: spec.originalPrompt,
        // No sessionId — re-record is a fresh session, not a continuation.
        // The reRecord field tells the service to overwrite the spec on
        // a clean session_end.
        reRecord: { slug: spec.slug },
      },
    }));
  };

  // ─── tab switching ─────────────────────────────────────────────────
  const sessionsTabs = root.querySelectorAll('.sessions-tab');
  const sessionsPanes = root.querySelectorAll('.sessions-pane');
  const activateSessionsTab = (which) => {
    sessionsTabs.forEach((t) => {
      const on = t.dataset.tab === which;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    sessionsPanes.forEach((p) => {
      p.hidden = p.dataset.tab !== which;
    });
  };
  sessionsTabs.forEach((t) => {
    t.addEventListener('click', () => activateSessionsTab(t.dataset.tab));
  });

  const openSkillsOverlay = () => {
    skillsOverlay.classList.add('open');
    skillsOverlay.setAttribute('aria-hidden', 'false');
    skillsBtn.classList.add('active');
    requestSkillsList();
    requestSpecsList();
  };

  const closeSkillsOverlay = () => {
    skillsOverlay.classList.remove('open');
    skillsOverlay.setAttribute('aria-hidden', 'true');
    skillsBtn.classList.remove('active');
  };

  skillsBtn.addEventListener('click', () => {
    if (skillsOverlay.classList.contains('open')) closeSkillsOverlay();
    else openSkillsOverlay();
  });
  skillsCloseBtn.addEventListener('click', closeSkillsOverlay);

  // ───────────────────────── agents overlay ─────────────────────────
  //
  // Lifecycle: on `hello` we have the server's currently-selected agent and
  // know nothing about availability; a `agents` follow-up event ships the
  // full availability list (installed + not-installed). Subsequent
  // switch-agent requests echo a new `agents` event back to all connected
  // widgets so multiple browser windows stay in sync.

  const findAgent = (id) =>
    state.availableAgents.find((a) => a.id === id) || null;

  const renderAgentButton = () => {
    const a = findAgent(state.currentAgent);
    const label = a?.label || state.currentAgent || 'agent';
    // Header is tight; show just the first word ("Claude", "OpenAI") so
    // we don't wrap when modes / cost / running pills are all visible.
    // Full label still lands in the tooltip + overlay rows.
    const shortLabel = label.split(/\s+/)[0];
    agentLabelEl.textContent = shortLabel;
    const showWarn = a?.sandboxStrength === 'soft';
    agentWarnEl.hidden = !showWarn;
    agentBtn.title = showWarn
      ? `${label} — soft sandbox (no built-in-tool deny list)`
      : `Switch coding agent (${label})`;
  };

  const renderAgentsOverlay = () => {
    agentsCountEl.textContent = String(state.availableAgents.length);
    agentsListEl.innerHTML = '';
    if (state.availableAgents.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'skills-empty';
      empty.textContent = 'No agents registered.';
      agentsListEl.appendChild(empty);
      return;
    }
    for (const a of state.availableAgents) {
      const row = document.createElement('div');
      row.className = 'agent-row';
      const isCurrent = a.id === state.currentAgent;
      if (isCurrent) row.classList.add('current');
      if (!a.installed) row.classList.add('uninstalled');

      const main = document.createElement('div');
      main.className = 'agent-main';

      const labelRow = document.createElement('div');
      labelRow.className = 'agent-rowlabel';
      labelRow.textContent = a.label;

      const installedBadge = document.createElement('span');
      installedBadge.className = `agent-badge ${a.installed ? 'installed' : 'missing'}`;
      installedBadge.textContent = a.installed ? 'installed' : 'not installed';
      labelRow.appendChild(installedBadge);

      const sandboxBadge = document.createElement('span');
      sandboxBadge.className = `agent-badge ${a.sandboxStrength}`;
      sandboxBadge.textContent = a.sandboxStrength === 'hard' ? 'hard sandbox' : 'soft sandbox';
      labelRow.appendChild(sandboxBadge);

      main.appendChild(labelRow);

      if (a.tagline) {
        const tag = document.createElement('div');
        tag.className = 'agent-rowtag';
        tag.textContent = a.tagline;
        main.appendChild(tag);
      }

      if (!a.installed && a.installHint) {
        const hint = document.createElement('div');
        hint.className = 'agent-hint';
        hint.textContent = a.installHint;
        main.appendChild(hint);
      }

      const check = document.createElement('div');
      check.className = 'agent-rowcheck';
      check.textContent = isCurrent ? '✓' : '';

      row.appendChild(main);
      row.appendChild(check);

      if (a.installed && !isCurrent) {
        row.addEventListener('click', () => switchAgent(a.id));
      } else if (!a.installed) {
        row.title = 'Run the install command below, then reopen this menu.';
      }

      agentsListEl.appendChild(row);
    }
  };

  const switchAgent = (id) => {
    if (running) {
      // The server also rejects this case; we mirror locally so the user
      // gets immediate feedback without a round-trip.
      addMessage({ kind: 'system', text: 'Stop the running command first, then switch agent.' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'switch-agent', payload: { agentId: id } }));
    closeAgentsOverlay();
  };

  const requestAgentsList = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'list-agents' }));
    }
  };

  const openAgentsOverlay = () => {
    agentsOverlay.classList.add('open');
    agentsOverlay.setAttribute('aria-hidden', 'false');
    agentBtn.classList.add('active');
    // Re-fetch on each open so we surface newly installed CLIs.
    requestAgentsList();
    renderAgentsOverlay();
  };

  const closeAgentsOverlay = () => {
    agentsOverlay.classList.remove('open');
    agentsOverlay.setAttribute('aria-hidden', 'true');
    agentBtn.classList.remove('active');
  };

  agentBtn.addEventListener('click', () => {
    if (agentsOverlay.classList.contains('open')) closeAgentsOverlay();
    else openAgentsOverlay();
  });
  agentsCloseBtn.addEventListener('click', closeAgentsOverlay);

  // Initial render so the button has something before the server replies.
  renderAgentButton();

  // ───────────────────────── settings overlay ─────────────────────────
  //
  // Simple toggles panel. Same shape as skills / agents overlays but read
  // from the SETTINGS_KEY localStorage record (independent of the chat
  // state schema). Each toggle wires directly to the corresponding
  // settings.* field and a saveSettings() call on change.
  const openSettingsOverlay = () => {
    if (settingsTtsToggle) settingsTtsToggle.checked = settings.ttsEnabled;
    if (settingsReloadToggle) settingsReloadToggle.checked = settings.reloadBeforeRecording;
    settingsOverlay.classList.add('open');
    settingsOverlay.setAttribute('aria-hidden', 'false');
    settingsBtn.classList.add('active');
  };
  const closeSettingsOverlay = () => {
    settingsOverlay.classList.remove('open');
    settingsOverlay.setAttribute('aria-hidden', 'true');
    settingsBtn.classList.remove('active');
  };
  settingsBtn?.addEventListener('click', () => {
    if (settingsOverlay.classList.contains('open')) closeSettingsOverlay();
    else openSettingsOverlay();
  });
  settingsCloseBtn?.addEventListener('click', closeSettingsOverlay);
  settingsTtsToggle?.addEventListener('change', () => {
    settings.ttsEnabled = !!settingsTtsToggle.checked;
    saveSettings();
    // Flush any in-flight utterances when turning OFF so the user gets
    // immediate silence rather than the current sentence finishing.
    if (!settings.ttsEnabled) speaker?.cancel();
  });
  settingsReloadToggle?.addEventListener('change', () => {
    settings.reloadBeforeRecording = !!settingsReloadToggle.checked;
    saveSettings();
  });

  // ───────────────────────── modes overlay ─────────────────────────
  //
  // Lifecycle: server sends `modes` after `hello` whenever the catalogue
  // or current selection changes. The pill is hidden when no plugins
  // contribute modes; otherwise it shows the active mode (or "default"
  // when state.currentMode is null). A synthetic "default" row sits at
  // the top of the picker so the user can return to normal operation.
  //
  // set-mode is rejected by the server while a command is running, so
  // we mirror that locally for instant feedback (same pattern as
  // switchAgent).

  const renderModeButton = () => {
    const hasModes = state.availableModes.length > 0;
    modeBtn.hidden = !hasModes;
    // `has-modebar` flips on whenever the mode bar is showing — CSS uses
    // it to push the overlays down by 28px so they don't peek out under
    // the bar. Independent of `mode-engaged`, which is the colour-tint
    // state for when a non-default mode is active.
    panel.classList.toggle('has-modebar', hasModes);
    // Mirror the engaged state on .panel and .launcher so they tint
    // alongside the modebar — the user spots the altered state without
    // needing the panel open.
    const engaged = state.currentMode !== null;
    panel.classList.toggle('mode-engaged', engaged);
    launcher.classList.toggle('mode-engaged', engaged);
    // Also mark the shadow host so :host(.mode-engaged) can retint elements
    // that live OUTSIDE .panel — notably the floating tooltip, which is a
    // sibling of .panel and so wouldn't inherit .panel's --accent override.
    host.classList.toggle('mode-engaged', engaged);
    if (!hasModes) return;
    const cur = state.availableModes.find((m) => m.id === state.currentMode);
    modeLabelEl.textContent = cur?.label || 'Default';
    // Hint is a short affordance ("click to switch") or a short engaged
    // tag ("plugin active") — NOT the full description, which pushed the
    // primary label out of view. Description still lands in the modes
    // overlay rows where there's room for it.
    if (modeHintEl) {
      // Engaged: the mode's own short status (e.g. "MITM proxy active"),
      // falling back to "active". Not engaged: the switch affordance.
      modeHintEl.textContent = engaged
        ? cur?.engagedHint || 'active'
        : 'click to switch';
    }
    modeBtn.classList.toggle('engaged', engaged);
    // Deliberately no tooltip — the bar's own text already says the
    // mode name + affordance, so a hover bubble repeating it adds noise.
    //
    // Plugin-contributed UI (network panel button, plugin overlays, plugin
    // CSS) is wired by the host's applyMode() — invoked from the WS `modes`
    // handler, NOT here. This function only updates the mode bar pill.
  };

  // ───────────────────────── default-mode visibility ─────────────────────────
  //
  // The default mode "owns" its own UI elements (Record button, Fix button,
  // textarea, Send, voice mic, …). When a plugin mode is active, default
  // hides its own widgets so the plugin's UI is the only thing offering
  // affordances. This is the inverse of the v0.9.0-original "plugin hides
  // core elements" design — by having core hide its own widgets, plugins
  // never need to know core's selectors (e.g. `.record-btn` / `.fix-btn`).
  //
  // Called from the WS `modes` handler whenever currentMode changes. Pulls
  // the trigger on in-flight recording / fix-picking sessions too — they
  // belong to default mode semantically, so they shouldn't survive a switch
  // to a plugin mode.
  const applyDefaultModeVisibility = (newMode) => {
    const inDefault = newMode === null;
    // Hide default-only footer affordances when a plugin mode is active.
    // Both buttons have rules `.foo[hidden] { display: none !important }`
    // via the catch-all in style.css, so `hidden = true` reliably collapses
    // them despite the explicit `display: inline-flex` on .fix-btn.
    if (recordBtn) recordBtn.hidden = !inDefault;
    if (fixBtn) fixBtn.hidden = !inDefault;
    // Tear down in-flight default-mode interactions that the new mode would
    // visually break. Skipped on the way INTO default (nothing to tear down).
    if (!inDefault) {
      // setRecording / cancelFixMode are defined later in this IIFE; this
      // closure resolves them at call time, which is always post-WS-open
      // (the `modes` payload arrives after `hello`). Guard each with a
      // typeof to keep the early-init case sane.
      if (typeof recording !== 'undefined' && recording && typeof setRecording === 'function') {
        setRecording(false);
      }
      if (typeof fixMode !== 'undefined' && fixMode && typeof cancelFixMode === 'function') {
        cancelFixMode();
      }
    }
  };

  const renderModesOverlay = () => {
    modesCountEl.textContent = String(state.availableModes.length + 1); // +1 for "default"
    modesListEl.innerHTML = '';

    // Synthetic "default" row at the top.
    const defaultRow = document.createElement('div');
    defaultRow.className = 'mode-row';
    const isDefaultCurrent = state.currentMode === null;
    if (isDefaultCurrent) defaultRow.classList.add('current');
    const dMain = document.createElement('div');
    dMain.className = 'mode-main';
    const dLabel = document.createElement('div');
    dLabel.className = 'mode-rowlabel';
    dLabel.textContent = 'Default';
    dMain.appendChild(dLabel);
    const dTag = document.createElement('div');
    dTag.className = 'mode-rowtag';
    dTag.textContent = 'Normal Hover, no plugin sidecars running.';
    dMain.appendChild(dTag);
    const dCheck = document.createElement('div');
    dCheck.className = 'mode-rowcheck';
    dCheck.textContent = isDefaultCurrent ? '✓' : '';
    defaultRow.appendChild(dMain);
    defaultRow.appendChild(dCheck);
    if (!isDefaultCurrent) defaultRow.addEventListener('click', () => switchMode(null));
    modesListEl.appendChild(defaultRow);

    for (const m of state.availableModes) {
      const row = document.createElement('div');
      row.className = 'mode-row';
      const isCurrent = m.id === state.currentMode;
      if (isCurrent) row.classList.add('current');
      const main = document.createElement('div');
      main.className = 'mode-main';
      const label = document.createElement('div');
      label.className = 'mode-rowlabel';
      label.textContent = m.label;
      main.appendChild(label);
      if (m.description) {
        const tag = document.createElement('div');
        tag.className = 'mode-rowtag';
        tag.textContent = m.description;
        main.appendChild(tag);
      }
      if (m.pluginName) {
        const plugin = document.createElement('div');
        plugin.className = 'mode-pluginname';
        plugin.textContent = m.pluginName;
        main.appendChild(plugin);
      }
      const check = document.createElement('div');
      check.className = 'mode-rowcheck';
      check.textContent = isCurrent ? '✓' : '';
      row.appendChild(main);
      row.appendChild(check);
      if (!isCurrent) row.addEventListener('click', () => switchMode(m.id));
      modesListEl.appendChild(row);
    }
  };

  const switchMode = (id) => {
    if (running) {
      // Server also rejects this — mirror locally for immediate feedback.
      addMessage({ kind: 'system', text: 'Stop the running command first, then switch mode.' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Plugin-owned state (e.g. captured flows under @hover-dev/security)
    // is cleaned up by the host's deactivate path — no per-mode logic
    // needed here.
    ws.send(JSON.stringify({ type: 'set-mode', payload: { modeId: id } }));
    closeModesOverlay();
  };

  const openModesOverlay = () => {
    modesOverlay.classList.add('open');
    modesOverlay.setAttribute('aria-hidden', 'false');
    modeBtn.classList.add('active');
    renderModesOverlay();
  };
  const closeModesOverlay = () => {
    modesOverlay.classList.remove('open');
    modesOverlay.setAttribute('aria-hidden', 'true');
    modeBtn.classList.remove('active');
  };
  modeBtn.addEventListener('click', () => {
    if (modesOverlay.classList.contains('open')) closeModesOverlay();
    else openModesOverlay();
  });
  modesCloseBtn.addEventListener('click', closeModesOverlay);

  renderModeButton();

  // ───────────────────────── custom tooltip ─────────────────────────
  //
  // Replaces the native `title=` tooltip which (a) renders in OS chrome
  // with a noticeable delay (~500-1000ms) and a light theme that clashes
  // with the dark panel, and (b) doesn't appear on keyboard focus, only
  // mouse hover. Targets are any element under the shadow root with a
  // non-empty `data-tooltip` attribute. Shows ~120ms after enter/focus,
  // hides immediately on leave/blur/scroll/Esc.
  //
  // Side selection:
  //   - default: above (or below if not enough space)
  //   - opt-in: data-tooltip-side="left" | "right" | "below"
  //   - the launcher uses side="left" so the bubble sits left of the
  //     floating ball instead of off-screen above the viewport.
  const tipEl = $('.hover-tip');
  const tipText = $('.hover-tip-text');
  let tipTarget = null;
  let tipShowTimer = 0;
  let tipHideTimer = 0;
  const TIP_OPEN_DELAY = 120;
  const TIP_CLOSE_GRACE = 40;
  const TIP_GAP = 6;          // px between target and bubble
  const TIP_VIEWPORT_PAD = 8; // px to keep bubble inside viewport

  const positionTip = (target) => {
    const r = target.getBoundingClientRect();
    const tr = tipEl.getBoundingClientRect();
    const requested = target.getAttribute('data-tooltip-side') || 'above';
    // Pick a final side, falling back when the requested one would clip.
    const fits = {
      above: r.top >= tr.height + TIP_GAP + TIP_VIEWPORT_PAD,
      below: window.innerHeight - r.bottom >= tr.height + TIP_GAP + TIP_VIEWPORT_PAD,
      left:  r.left >= tr.width + TIP_GAP + TIP_VIEWPORT_PAD,
      right: window.innerWidth - r.right >= tr.width + TIP_GAP + TIP_VIEWPORT_PAD,
    };
    const fallback = ['above', 'below', 'left', 'right'];
    let side = fits[requested] ? requested : (fallback.find(s => fits[s]) || requested);
    tipEl.setAttribute('data-side', side);

    let top, left;
    if (side === 'above') {
      top = r.top - tr.height - TIP_GAP;
      left = r.left + (r.width - tr.width) / 2;
    } else if (side === 'below') {
      top = r.bottom + TIP_GAP;
      left = r.left + (r.width - tr.width) / 2;
    } else if (side === 'left') {
      top = r.top + (r.height - tr.height) / 2;
      left = r.left - tr.width - TIP_GAP;
    } else { // right
      top = r.top + (r.height - tr.height) / 2;
      left = r.right + TIP_GAP;
    }
    // Clamp to viewport so the bubble doesn't slide off the edge.
    left = Math.max(TIP_VIEWPORT_PAD, Math.min(left, window.innerWidth - tr.width - TIP_VIEWPORT_PAD));
    top  = Math.max(TIP_VIEWPORT_PAD, Math.min(top, window.innerHeight - tr.height - TIP_VIEWPORT_PAD));
    tipEl.style.top  = `${top}px`;
    tipEl.style.left = `${left}px`;
  };

  const showTip = (target) => {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    tipTarget = target;
    tipText.textContent = text;
    tipEl.setAttribute('aria-hidden', 'false');
    // First make the bubble measurable (CSS sets opacity 0 so it's not visible
    // yet), then position, then add the .visible class to fade in.
    tipEl.style.top = '-1000px';
    tipEl.style.left = '-1000px';
    tipEl.classList.add('visible'); // forces layout so getBoundingClientRect is meaningful
    positionTip(target);
  };

  const hideTip = () => {
    tipTarget = null;
    tipEl.classList.remove('visible');
    tipEl.setAttribute('aria-hidden', 'true');
  };

  const cancelShowTimer = () => {
    if (tipShowTimer) { clearTimeout(tipShowTimer); tipShowTimer = 0; }
  };
  const cancelHideTimer = () => {
    if (tipHideTimer) { clearTimeout(tipHideTimer); tipHideTimer = 0; }
  };

  const findTipTarget = (ev) => {
    // event.composedPath() crosses the shadow boundary so the launcher
    // (sibling of .panel) is reachable too.
    for (const node of ev.composedPath()) {
      if (node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-tooltip')) {
        return node;
      }
      if (node === host) break;
    }
    return null;
  };

  root.addEventListener('mouseover', (ev) => {
    // Suppress tooltips while any full-panel overlay or popover is
    // open — they cover the header buttons, but mouseover still fires
    // on the elements underneath, and tooltips render on a higher
    // z-index so they punch through visually. Query lazily here
    // (fixPopover and plugin overlays are declared later in the IIFE
    // / appended at runtime by the host).
    const fixOpen = root.querySelector('.fix-popover.visible');
    const pluginOverlayOpen = root.querySelector('.plugin-overlay.open');
    if (fixOpen || pluginOverlayOpen) return;
    const target = findTipTarget(ev);
    if (!target || target === tipTarget) return;
    cancelHideTimer();
    cancelShowTimer();
    tipShowTimer = setTimeout(() => showTip(target), TIP_OPEN_DELAY);
  });

  root.addEventListener('mouseout', (ev) => {
    // Only hide if we're actually leaving the current target (and not just
    // moving across one of its children with pointer-events on).
    if (!tipTarget) return;
    const related = ev.relatedTarget;
    if (related && tipTarget.contains(related)) return;
    cancelShowTimer();
    cancelHideTimer();
    tipHideTimer = setTimeout(hideTip, TIP_CLOSE_GRACE);
  });

  // Keyboard accessibility — also makes the launcher discoverable for users
  // who tab into the page.
  root.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (t && t.hasAttribute && t.hasAttribute('data-tooltip')) {
      cancelHideTimer();
      cancelShowTimer();
      tipShowTimer = setTimeout(() => showTip(t), TIP_OPEN_DELAY);
    }
  });
  root.addEventListener('focusout', () => {
    cancelShowTimer();
    hideTip();
  });

  // Any scroll inside the panel invalidates the cached position; hide.
  // (Repositioning would be cleaner but for header buttons scrolling never
  // moves them, so the simple "hide" rule is fine.)
  root.addEventListener('scroll', hideTip, true);

  // Esc dismisses the tooltip without closing the panel.
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && tipTarget) {
      hideTip();
      // Don't stopPropagation — modal/overlay Esc handlers still run.
    }
  });

  // Mouse click on the target hides the bubble too — otherwise it lingers
  // after the user has already acted on the affordance.
  root.addEventListener('mousedown', () => {
    cancelShowTimer();
    hideTip();
  }, true);

  // ───────────────────────── status + new conversation ─────────────────────────

  const setStatus = (text, cls) => {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`;
  };

  starBtn.addEventListener('click', () => {
    window.open('https://github.com/Hyperyond/Hover', '_blank', 'noopener,noreferrer');
  });

  newBtn.addEventListener('click', async () => {
    if (state.messages.length === 0 && !state.sessionId && state.assertions.length === 0) return;
    const ok = await hoverConfirm({
      title: 'Start a new conversation?',
      body: 'Current history and any pending assertions will be cleared.',
      confirmLabel: 'Start new',
      danger: true,
    });
    if (!ok) return;
    state.messages = [];
    state.sessionId = null;
    state.assertions = [];
    // Don't animate the empty state as if it were fresh content.
    lastRenderedGroupCount = 0;
    // Drop any pending TTS so the new conversation starts in silence.
    speaker?.cancel();
    saveState();
    renderAll();
    updateAssertBadge();
    hideCost();
  });

  // ───────────────────────── Pending assertions badge ─────────────────
  //
  // The header badge shows how many checks are queued for the next Save
  // as Spec. Assertions are produced by the Record sub-toolbar's check
  // sub-modes (Exists / Says / Equals) and accumulate in state.assertions;
  // Save as Spec bakes them in and clears the list.

  const updateAssertBadge = () => {
    const n = state.assertions.length;
    if (n === 0) {
      assertBtn.hidden = true;
    } else {
      assertBtn.hidden = false;
      assertCountEl.textContent = String(n);
    }
  };

  assertBtn.addEventListener('click', async () => {
    const n = state.assertions.length;
    if (n === 0) return;
    const ok = await hoverConfirm({
      title: 'Clear pending assertions?',
      body: `${n} assertion${n === 1 ? '' : 's'} will be discarded. They have not been saved to a spec yet.`,
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    state.assertions = [];
    saveState();
    updateAssertBadge();
    addMessage({ kind: 'system', text: 'Cleared pending assertions.' });
  });

  // ─────────────── Picker hover-mode (element preview) ─────────────
  //
  // When the user enters Fix mode or a Record check sub-mode, we light
  // up an overlay that tracks `elementFromPoint` and draws a badge
  // naming the pending action (Fix / Check: Exists / Check: Says /
  // Check: Equals). The overlay lives in the shadow root with
  // pointer-events:none, so it never intercepts the click and never
  // pollutes the host page DOM.

  const pickerOverlay = $('.picker-overlay');
  const pickerBadge = $('.picker-badge');
  const pickerTag = $('.picker-tag');
  // Picker mode drives the host-page hover outline + the corner badge
  // text. Three independent entry points set it:
  //   • Fix button (footer)                       → 'fix'
  //   • Recording mode + assert sub-toolbar       → 'assert-visible' / 'assert-text' / 'assert-value'
  // (Plain Action recording does NOT activate the picker — clicks go
  // through as host-page interactions and get captured as steps.)
  let pickerMode = null;
  let pickerLastTarget = null;
  let fixMode = false; // mirror of pickerMode === 'fix' for click-handler guards
  // Last cursor position — tracked passively. The mode setters use it so
  // the overlay paints immediately on activation without waiting for the
  // next mousemove.
  let lastMouseX = -1;
  let lastMouseY = -1;

  // Badge text per mode. Kept short — the overlay is tight on space.
  function badgeForMode(mode) {
    switch (mode) {
      case 'fix': return 'Fix';
      case 'assert-visible': return 'Check: Exists';
      case 'assert-text':    return 'Check: Says';
      case 'assert-value':   return 'Check: Equals';
      default: return '';
    }
  }

  function updatePickerOverlay(target, mode) {
    if (!target || !(target instanceof Element)) {
      pickerOverlay.classList.remove('visible');
      pickerLastTarget = null;
      return;
    }
    // Skip elements inside the widget shadow tree.
    if (target.closest('[data-hover="true"]') === host) {
      pickerOverlay.classList.remove('visible');
      return;
    }
    // <html> / <body> are too coarse to be useful targets.
    if (target === document.documentElement || target === document.body) {
      pickerOverlay.classList.remove('visible');
      return;
    }
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      pickerOverlay.classList.remove('visible');
      return;
    }
    pickerOverlay.style.left = `${r.left - 2}px`;
    pickerOverlay.style.top = `${r.top - 2}px`;
    pickerOverlay.style.width = `${r.width + 4}px`;
    pickerOverlay.style.height = `${r.height + 4}px`;
    pickerBadge.textContent = badgeForMode(mode);
    pickerTag.textContent = `<${target.tagName.toLowerCase()}>`;
    pickerOverlay.classList.add('visible');
    pickerLastTarget = target;
  }

  // Esc cancels whichever mode is active. The two branches are mutually
  // exclusive — fixMode and assert-* can't both be active (fixMode is set
  // only by enterFixMode which is reachable only when not in an assert
  // sub-mode), but the early return makes that invariant explicit and
  // avoids the surprise of both branches firing if a future code path
  // ever managed to overlap them.
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Escape') return;
    if (fixMode) {
      cancelFixMode();
      return;
    }
    if (pickerMode && pickerMode.startsWith('assert-')) {
      setRecordSubMode('action');
    }
  });
  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (!pickerMode) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    updatePickerOverlay(el, pickerMode);
  });

  // ─────────────────── Toast helper (used by picker actions) ─────────────
  //
  // A single shared strip at the top of the viewport. Lives in the shadow
  // root so styling is isolated, but sits above .panel — visible even when
  // the panel is closed (the common case during element picking).

  const toastEl = $('.picker-toast');
  let toastTimer = null;
  function showPickerToast(text, opts = {}) {
    if (!toastEl) return;
    toastEl.classList.toggle('error', !!opts.error);
    toastEl.innerHTML = '';
    const icon = document.createElement('span');
    icon.className = 'picker-toast-icon';
    icon.textContent = opts.error ? '⊘' : '✓';
    const label = document.createElement('span');
    label.textContent = text;
    toastEl.appendChild(icon);
    toastEl.appendChild(label);
    toastEl.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('visible');
    }, opts.error ? 3500 : 2500);
  }

  // ─────────────────── Fix mode (footer "Fix" button) ───────────────────
  //
  // User clicks the Fix button → fix-mode starts, panel auto-opens, cursor
  // becomes crosshair, host-page hover paints a mint outline with a "Fix"
  // badge (shared picker-overlay component). User clicks any host-page
  // element → panel body switches to the fix-popover view (right side of
  // the screen — host page is untouched). User types their intent and hits
  // Copy / ⌘↵; the structured fact blob below is prepended with the intent,
  // copied to clipboard, and the user pastes into their coding agent.
  //
  // Hybrid context for the chosen element:
  //   • element's own data-hover-source (Vite transform output)
  //   • likely-target descent (e.g. <div> wrapper → <button> inside it)
  //   • DOM ancestor data-hover-source chain (the user's call site lives
  //     in the ancestors for wrapper-rendered hosts: styled-components,
  //     className-forwarding components, multi-layer nesting)
  //   • React _debugOwner name chain — owners survived in React 19 even
  //     though _debugSource didn't; gives grep keywords for styled-
  //     components and other library-rendered hosts
  //   • Playwright selector + outerHTML excerpt
  //
  // Hover's own sandboxed agent only has the Playwright MCP, so this is
  // a clipboard handoff — not a server call.

  const fixBtn = $('.fix-btn');
  const fixPopover = $('.fix-popover');
  const fixPopoverElTag = fixPopover && fixPopover.querySelector('.fix-popover-el-tag');
  const fixPopoverElText = fixPopover && fixPopover.querySelector('.fix-popover-el-text');
  const fixPopoverElSrc = fixPopover && fixPopover.querySelector('.fix-popover-el-src');
  const fixPopoverInput = fixPopover && fixPopover.querySelector('.fix-popover-input');
  const fixPopoverCopy = fixPopover && fixPopover.querySelector('.fix-popover-copy');
  const fixPopoverCancel = fixPopover && fixPopover.querySelector('.fix-popover-cancel');
  let fixSelectedElement = null;
  let fixSelectedCtx = null;

  function enterFixMode() {
    if (fixMode) return;
    fixMode = true;
    pickerMode = 'fix';
    // If we're currently recording, pause capture so the user can fix
    // an element they noticed mid-flow without ending the session and
    // losing the Done card. exitFixMode resumes.
    if (recording) {
      recordingPaused = true;
      host.classList.add('record-paused');
    }
    // Ensure panel is open so the user can see the popover when they click.
    if (!isOpen()) launcher.click();
    host.classList.add('picker-active');
    host.classList.add('fix-active');
    fixBtn.classList.add('active');
    updateMutexUi();
    if (lastMouseX >= 0) {
      const el = document.elementFromPoint(lastMouseX, lastMouseY);
      updatePickerOverlay(el, 'fix');
    }
  }

  function exitFixMode() {
    if (!fixMode) return;
    fixMode = false;
    if (pickerMode === 'fix') pickerMode = null;
    host.classList.remove('picker-active');
    host.classList.remove('fix-active');
    fixBtn.classList.remove('active');
    pickerOverlay.classList.remove('visible');
    pickerLastTarget = null;
    if (recordingPaused) {
      recordingPaused = false;
      host.classList.remove('record-paused');
    }
    updateMutexUi();
  }

  function cancelFixMode() {
    closeFixPopover();
    exitFixMode();
  }

  function showFixPopover(el) {
    fixSelectedElement = el;
    const ctx = collectFixContext(el);
    fixSelectedCtx = ctx;
    const headlineEl = ctx.target.el;
    fixPopoverElTag.textContent = `<${headlineEl.tagName.toLowerCase()}>`;
    fixPopoverElText.textContent = ctx.target.text || '';
    fixPopoverElSrc.textContent = ctx.target.ownStamp || ctx.ancestorStamps[0]?.src || '(no source stamp)';
    fixPopover.setAttribute('aria-hidden', 'false');
    fixPopover.classList.add('visible');
    panel.classList.add('fix-popover-open');
    fixPopoverInput.value = '';
    setTimeout(() => fixPopoverInput.focus(), 30);
  }

  function closeFixPopover() {
    fixPopover.classList.remove('visible');
    fixPopover.setAttribute('aria-hidden', 'true');
    panel.classList.remove('fix-popover-open');
    fixSelectedElement = null;
    fixSelectedCtx = null;
  }

  async function commitFixPopover() {
    if (!fixSelectedCtx) return;
    const intent = fixPopoverInput.value.trim();
    const prompt = renderFixPrompt(fixSelectedCtx, intent);
    let copied = false;
    try {
      await navigator.clipboard.writeText(prompt);
      copied = true;
    } catch {
      copied = false;
    }
    const label = fixSelectedCtx.target.selector?.hint || fixSelectedCtx.target.tag;
    if (copied) {
      addMessage({
        kind: 'system',
        text: `📋 Fix prompt copied for ${label} — paste into your coding agent.`,
      });
      showPickerToast('Fix prompt copied — paste into your coding agent');
    } else {
      addMessage({
        kind: 'system',
        text: `⚠ Couldn't copy to clipboard. Prompt for ${label} printed to console.`,
      });
      showPickerToast('Clipboard blocked — prompt printed to console', { error: true });
      console.info('[hover] fix prompt:\n' + prompt);
    }
    cancelFixMode();
  }

  if (fixBtn) {
    fixBtn.addEventListener('click', () => {
      if (fixMode) {
        cancelFixMode();
      } else {
        enterFixMode();
      }
    });
  }

  // Record and Fix coexist via pause-insert-resume:
  //   - Fix is enterable mid-recording — it pauses capture while the
  //     popover is open, and recording resumes automatically when Fix
  //     closes. The Fix-button tooltip changes to reflect this.
  //   - Record is blocked while Fix is open. Stop / Resume of the
  //     recording happens through the Fix popover lifecycle, not by
  //     clicking the Record button — so we disable it to prevent the
  //     user from accidentally ending the paused session.
  function updateMutexUi() {
    if (!fixBtn || !recordBtn) return;
    if (recording) {
      fixBtn.disabled = false;
      fixBtn.setAttribute('data-tooltip', 'Pause recording, suggest a fix, then resume — the recording continues automatically when you close Fix');
    } else {
      fixBtn.disabled = false;
      fixBtn.setAttribute('data-tooltip', 'Click a page element, describe what to change, copy a prompt for your coding agent');
    }
    if (fixMode) {
      recordBtn.disabled = true;
      recordBtn.setAttribute('data-tooltip', 'Close Fix to continue with Record');
    } else {
      recordBtn.disabled = false;
      recordBtn.setAttribute('data-tooltip', 'Record your own clicks/typing on the page');
    }
  }
  if (fixPopover) {
    fixPopoverCopy.addEventListener('click', commitFixPopover);
    fixPopoverCancel.addEventListener('click', cancelFixMode);
    fixPopoverInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        commitFixPopover();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelFixMode();
      }
    });
  }

  // Capture-phase click during fix-mode picks the element and shows popover.
  document.addEventListener('click', (e) => {
    if (!fixMode) return;
    // Once the popover is open, the user is editing intent for an already
    // chosen element. Letting a stray click on the host page silently
    // re-target the popover (overwriting their typed text) is a footgun.
    // Cancel/Esc/⌘↵ is the only way out from the popover state.
    if (fixPopover && fixPopover.classList.contains('visible')) return;
    if (e.composedPath().includes(host)) return; // ignore clicks inside widget
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    if (!(target instanceof Element) || target === document.documentElement || target === document.body) return;
    pickerOverlay.classList.remove('visible');
    host.classList.remove('picker-active');
    host.classList.remove('fix-active');
    // Collect context BEFORE flashElement so the transient outline style
    // doesn't end up in the captured outerHTML.
    showFixPopover(target);
    flashElement(target);
  }, { capture: true });

  // "Interactive" tag check — used by the likely-target descent.
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.hasAttribute('role')) {
      const r = el.getAttribute('role');
      if (r === 'button' || r === 'link' || r === 'checkbox' || r === 'radio' || r === 'switch' || r === 'tab' || r === 'menuitem') return true;
    }
    return false;
  }

  // If the clicked element isn't itself interactive but contains exactly
  // one interactive descendant, that's almost certainly what the user
  // meant — e.g. clicking a wrapping <div> aimed at the <button> inside.
  // Returns the deeper element or null.
  function findLikelyInteractiveTarget(el) {
    if (isInteractive(el)) return null; // already the target
    const candidates = el.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="radio"]');
    if (candidates.length === 1) return candidates[0];
    return null;
  }

  function elementSummary(el) {
    const ownStamp = el.getAttribute('data-hover-source');
    const selector = bestSelector(el);
    // Outer HTML, normalised: drop empty style="" attrs and the transient
    // outline/transition style flashElement injects on commit; cap length.
    let outer = (el.outerHTML || '');
    outer = outer.replace(/\sstyle=""/g, '');
    outer = outer.replace(/\sstyle="[^"]*(?:outline|transition)[^"]*"/g, '');
    outer = outer.slice(0, 400);
    const text = (el.textContent || '').trim().slice(0, 120);
    return { el, tag: el.tagName.toLowerCase(), text, ownStamp, selector, outer };
  }

  function collectFixContext(el) {
    // DOM ancestor chain (parent → root), up to 8 levels. The user's call
    // site is in here for wrapper-rendered hosts.
    const ancestorStamps = [];
    let cur = el.parentElement;
    let depth = 0;
    while (cur && cur !== document.body && depth < 8) {
      const s = cur.getAttribute?.('data-hover-source');
      if (s) ancestorStamps.push({ tag: cur.tagName.toLowerCase(), src: s });
      cur = cur.parentElement;
      depth++;
    }

    // React owner-name chain via _debugOwner. Names only — React 19 has
    // no _debugSource, so we can't get file locations from the fiber.
    const owners = [];
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (fiberKey) {
      let fiber = el[fiberKey];
      let safety = 30;
      while (fiber && safety-- > 0) {
        const t = fiber.type;
        const name = typeof t === 'string' ? null : (t?.displayName || t?.name || null);
        if (name && !owners.includes(name)) owners.push(name);
        fiber = fiber._debugOwner || fiber.return || null;
      }
    }

    // "target" is the element we point the agent at. If the clicked
    // element is a wrapper around a single interactive child, prefer the
    // child (Playwright selector + headline both come from it).
    const likely = findLikelyInteractiveTarget(el);
    const targetEl = likely ?? el;
    const target = elementSummary(targetEl);
    const clicked = likely ? elementSummary(el) : null;

    return { clicked, target, ancestorStamps, owners };
  }

  function renderFixPrompt(ctx, intent) {
    const lines = [];
    lines.push('Change this element in my app:');
    lines.push('');
    if (intent) {
      // Quote each line so the model parses the intent as a single block.
      for (const ln of intent.split('\n')) lines.push(`> ${ln}`);
      lines.push('');
    }
    if (ctx.clicked) {
      lines.push(`Clicked: <${ctx.clicked.tag}>${ctx.clicked.text ? ` — "${ctx.clicked.text}"` : ''}`);
      lines.push(`Most likely target: <${ctx.target.tag}>${ctx.target.text ? ` — "${ctx.target.text}"` : ''}`);
    } else {
      lines.push(`Element: <${ctx.target.tag}>${ctx.target.text ? ` — "${ctx.target.text}"` : ''}`);
    }
    if (ctx.target.ownStamp) {
      lines.push(`Source of likely target: ${ctx.target.ownStamp}`);
    }
    if (ctx.clicked?.ownStamp && ctx.clicked.ownStamp !== ctx.target.ownStamp) {
      lines.push(`Source of clicked element: ${ctx.clicked.ownStamp}`);
    }
    if (!ctx.target.ownStamp && !ctx.clicked?.ownStamp) {
      lines.push('Source: unavailable (likely rendered by a library wrapper — see ancestor chain)');
    }
    if (ctx.ancestorStamps.length > 0) {
      lines.push('Ancestor sources (closer ancestors first):');
      for (const a of ctx.ancestorStamps) lines.push(`  • <${a.tag}> @ ${a.src}`);
    }
    if (ctx.owners.length > 0) {
      lines.push(`React component chain (innermost first): ${ctx.owners.join(' → ')}`);
    }
    if (ctx.target.selector) {
      lines.push(`Playwright selector: ${ctx.target.selector.code}`);
    }
    lines.push('Outer HTML:');
    lines.push('  ' + ctx.target.outer);
    return lines.join('\n');
  }

  function inspectElement(el) {
    const sel = bestSelector(el);
    const ass = bestAssertion(el);
    if (!sel || !ass) return null;
    return {
      code: ass.code.replace('SEL', sel.code),
      hint: `${sel.hint} ${ass.hint}`,
    };
  }

  function bestSelector(el) {
    const testid = el.getAttribute('data-testid');
    if (testid) return { code: `page.getByTestId(${JSON.stringify(testid)})`, hint: `testid="${testid}"` };

    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return { code: `page.getByLabel(${JSON.stringify(ariaLabel)})`, hint: `label "${ariaLabel}"` };

    const role = roleOf(el);
    const name = accessibleName(el);
    if (role && name) return { code: `page.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(name)} })`, hint: `${role} "${name}"` };
    if (role) return { code: `page.getByRole(${JSON.stringify(role)})`, hint: role };

    const text = (el.textContent || '').trim();
    if (text && text.length < 80) return { code: `page.getByText(${JSON.stringify(text)})`, hint: `text "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"` };

    if (el.id) return { code: `page.locator('#${cssEscape(el.id)}')`, hint: `#${el.id}` };
    return null;
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'li') return 'listitem';
    if (tag === 'ul' || tag === 'ol') return 'list';
    return null;
  }

  function accessibleName(el) {
    // For inputs we want the associated label, not the value.
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      // aria-labelledby
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const lbl = document.getElementById(labelledby);
        if (lbl) return (lbl.textContent || '').trim();
      }
      // <label for=id>
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return (lbl.textContent || '').trim();
      }
      // Wrapping <label>
      let p = el.parentElement;
      while (p && p !== document.body) {
        if (p.tagName === 'LABEL') {
          const text = (p.textContent || '').trim();
          // Subtract the input's own value from the wrapping text if present
          const v = el.value ? text.split(el.value)[0].trim() : text;
          return v || text;
        }
        p = p.parentElement;
      }
      return el.placeholder || '';
    }
    return (el.textContent || '').trim().slice(0, 80);
  }

  function bestAssertion(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') {
        return el.checked
          ? { code: `expect(SEL).toBeChecked()`, hint: '· is checked' }
          : { code: `expect(SEL).not.toBeChecked()`, hint: '· is unchecked' };
      }
      const v = el.value ?? '';
      if (v) return { code: `expect(SEL).toHaveValue(${JSON.stringify(v)})`, hint: `· value "${String(v).slice(0, 30)}"` };
      return { code: `expect(SEL).toBeVisible()`, hint: '· visible' };
    }
    if (tag === 'textarea') {
      const v = el.value ?? '';
      if (v) return { code: `expect(SEL).toHaveValue(${JSON.stringify(v)})`, hint: '· has value' };
      return { code: `expect(SEL).toBeVisible()`, hint: '· visible' };
    }
    if (tag === 'select') {
      const v = el.value ?? '';
      return { code: `expect(SEL).toHaveValue(${JSON.stringify(v)})`, hint: `· "${v}" selected` };
    }
    if (el.disabled) return { code: `expect(SEL).toBeDisabled()`, hint: '· is disabled' };
    const text = (el.textContent || '').trim();
    if (text && text.length < 120) {
      return { code: `expect(SEL).toHaveText(${JSON.stringify(text)})`, hint: `· text "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"` };
    }
    return { code: `expect(SEL).toBeVisible()`, hint: '· visible' };
  }

  function cssEscape(s) {
    return s.replace(/(["\\#.:[\]>])/g, '\\$1');
  }

  // ───────────────────────── Recording mode ───────────────────────
  //
  // "Record" toggle in the footer. While recording, every manual click /
  // text input / select change / checkbox toggle on the host page is
  // captured and appended to state.messages as a step in the same shape
  // the agent emits — so writeSkill / writeSpec downstream don't care
  // whether the steps came from claude or from the user.
  //
  // Sub-toolbar lets the user switch what the next click captures:
  //   • action            — record click / fill / select as a Playwright step
  //   • assert-visible    — emit expect(SEL).toBeVisible(), one-shot
  //   • assert-text       — emit expect(SEL).toHaveText("…"),  one-shot
  //   • assert-value      — emit expect(SEL).toHaveValue("…"), one-shot
  // Assertion sub-modes are one-shot — after committing, the toolbar
  // snaps back to action. Pattern follows Playwright codegen.

  let recording = false;
  let recordingPaused = false; // true while a Fix popover is open mid-recording
  let recordStartIdx = 0;
  let recordStartAssertionsCount = 0; // state.assertions.length at session start (for per-session delta)
  let recordSubMode = 'action';
  const pendingFills = new Map(); // element → last seen value
  const recordToolbar = $('.record-toolbar');
  const recModeBtns = recordToolbar ? Array.from(recordToolbar.querySelectorAll('.rec-mode')) : [];

  function setRecordSubMode(mode) {
    recordSubMode = mode;
    for (const btn of recModeBtns) {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    // Drive the picker overlay so the user sees an outline + badge for
    // the element under the cursor whenever they're about to assert.
    if (recording && mode !== 'action') {
      pickerMode = mode;
      host.classList.add('picker-active');
      if (lastMouseX >= 0) {
        const el = document.elementFromPoint(lastMouseX, lastMouseY);
        updatePickerOverlay(el, mode);
      }
    } else {
      // Back to action mode — overlay off, cursor back to normal.
      if (pickerMode && pickerMode.startsWith('assert-')) {
        pickerMode = null;
        host.classList.remove('picker-active');
        pickerOverlay.classList.remove('visible');
        pickerLastTarget = null;
      }
    }
  }

  for (const btn of recModeBtns) {
    btn.addEventListener('click', () => {
      if (!recording) return;
      setRecordSubMode(btn.dataset.mode);
    });
  }

  const setRecording = (on) => {
    recording = on;
    if (on) {
      recordBtn.classList.add('recording');
      recLabel.textContent = 'Stop';
      // Send/textarea become inert while recording.
      sendBtn.disabled = true;
      textarea.disabled = true;
      addMessage({ kind: 'user', text: '(recording manual interactions)' });
      // Capture the starting URL as the first step so the saved spec opens
      // the right page before replaying clicks. Without this, a fresh
      // Playwright run starts on `about:blank`, `getByRole(...)` finds
      // nothing, and the first interaction times out with
      // "element(s) not found" — looks like a Hover bug but is really
      // a missing `await page.goto(...)`. Agent-driven sessions don't
      // hit this because the agent calls `browser_navigate` itself; only
      // manual Record needs the synthetic step.
      addMessage({
        kind: 'step',
        tool: 'browser_navigate',
        input: { url: window.location.href },
      });
      recordStartIdx = state.messages.length;
      recordStartAssertionsCount = state.assertions.length;
      // Show sub-toolbar; default to Record mode. First-use hint above
      // the mode buttons fades in once per browser, then we set a flag
      // so it stays hidden on subsequent recordings.
      host.classList.add('recording');
      const hintEl = $('.record-toolbar-hint');
      if (hintEl) {
        const seen = localStorage.getItem('hover:sub-toolbar-hint-seen') === '1';
        hintEl.hidden = seen;
        if (!seen) localStorage.setItem('hover:sub-toolbar-hint-seen', '1');
      }
      setRecordSubMode('action');
      updateMutexUi();
    } else {
      recordBtn.classList.remove('recording');
      recLabel.textContent = 'Record';
      host.classList.remove('recording');
      // Defensive: if the session somehow ended while a Fix popover was
      // open (HMR re-init, external call), recordingPaused could stick
      // true and silently suppress the next session's capture handlers.
      // Always clear here.
      recordingPaused = false;
      host.classList.remove('record-paused');
      // Clear any in-flight assert sub-mode + overlay.
      setRecordSubMode('action');
      flushAllFills();
      const wsReady = ws && ws.readyState === WebSocket.OPEN;
      sendBtn.disabled = !wsReady;
      textarea.disabled = !wsReady;
      const captured = state.messages.slice(recordStartIdx).filter(m => m.kind === 'step').length;
      // Per-session delta — assertions from previous unsaved sessions
      // are still in state.assertions (they'll bake in on Save), but
      // this Done card is about *this* session's count.
      const assertCount = Math.max(0, state.assertions.length - recordStartAssertionsCount);
      const parts = [`Recorded ${captured} action${captured === 1 ? '' : 's'}`];
      if (assertCount > 0) parts.push(`and ${assertCount} check${assertCount === 1 ? '' : 's'}`);
      const lead = parts.join(' ');
      addMessage({
        kind: 'done',
        turns: captured,
        costUsd: 0,
        source: 'recording',
        summary: `${lead}. Click Save as Skill / Spec on this card to keep it.`,
      });
      updateMutexUi();
    }
  };

  // sessionStorage flag survives a reload but not a tab close — exactly the
  // window we want for "user pressed Record, confirmed reload, page is
  // refreshing, resume recording on the new load". We set it before
  // location.reload() and consume it once the widget initialises.
  const RESUME_KEY = 'hover:resume-recording';

  recordBtn.addEventListener('click', () => {
    if (running) return;
    if (fixMode) return; // mutex with Fix
    // Stopping an in-progress recording is unconditional — no confirm, no
    // reload — symmetric with how it works today.
    if (recording) {
      setRecording(false);
      return;
    }
    if (settings.reloadBeforeRecording) {
      const ok = window.confirm(
        'Reload the page before recording?\n\n' +
        'This gives the saved spec a clean starting state to replay from. ' +
        'Any unsaved page state (forms, in-memory data) will be lost.'
      );
      if (!ok) return;
      try { sessionStorage.setItem(RESUME_KEY, '1'); } catch {}
      window.location.reload();
      return;
    }
    setRecording(true);
  });

  // Post-reload resume: if the previous page wrote the resume flag, kick
  // recording on once the widget is wired up. Use a queueMicrotask so the
  // surrounding init finishes first (state, listeners, WebSocket) before
  // we start mutating recording state.
  try {
    if (sessionStorage.getItem(RESUME_KEY) === '1') {
      sessionStorage.removeItem(RESUME_KEY);
      queueMicrotask(() => {
        if (!recording && !running && !fixMode) setRecording(true);
      });
    }
  } catch {}

  function recordStep(tool, input) {
    addMessage({ kind: 'step', tool, input });
  }

  function flushFillFor(el) {
    if (!pendingFills.has(el)) return;
    const value = pendingFills.get(el);
    pendingFills.delete(el);
    const name = accessibleName(el) || el.getAttribute('name') || el.getAttribute('placeholder') || '';
    const role = roleOf(el) || 'textbox';
    recordStep('browser_fill_form', {
      fields: [{ name, type: role, value }],
    });
  }

  function flushAllFills() {
    for (const el of [...pendingFills.keys()]) flushFillFor(el);
  }

  function describeForAgent(el) {
    const name = accessibleName(el);
    const role = roleOf(el);
    if (role && name) return `${name} ${role}`;
    if (name) return `"${name}"`;
    if (role) return role;
    return el.tagName.toLowerCase();
  }

  document.addEventListener(
    'input',
    (e) => {
      if (!recording) return;
      if (recordingPaused) return; // Fix popover open mid-recording
      if (recordSubMode !== 'action') return; // assert sub-modes don't capture typing
      if (e.composedPath().includes(host)) return;
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'checkbox' || t === 'radio') return; // handled on change
        pendingFills.set(el, el.value);
      }
    },
    { capture: true },
  );

  document.addEventListener(
    'change',
    (e) => {
      if (!recording) return;
      if (recordingPaused) return; // Fix popover open mid-recording
      if (recordSubMode !== 'action') return; // assert sub-modes don't capture changes
      if (e.composedPath().includes(host)) return;
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;

      if (el.tagName === 'SELECT') {
        recordStep('browser_select_option', {
          element: describeForAgent(el),
          values: [el.value],
        });
        return;
      }
      if (el.tagName === 'INPUT') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'checkbox' || t === 'radio') {
          recordStep('browser_click', { element: describeForAgent(el) });
          return;
        }
      }
      // Text input / textarea — finalize pending value
      flushFillFor(el);
    },
    { capture: true },
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!recording) return;
      if (recordingPaused) return; // Fix popover open mid-recording
      if (e.composedPath().includes(host)) return;
      const el = e.target;
      if (!(el instanceof Element)) return;

      // Flush any text input the user was typing in before this click.
      flushAllFills();

      // In an assert sub-mode the click commits an assertion instead of
      // a recorded action step. One-shot — snap back to action after.
      if (recordSubMode !== 'action') {
        e.preventDefault();
        e.stopPropagation();
        const ass = buildRecordingAssertion(el, recordSubMode);
        const checkLabel = badgeForMode(recordSubMode).replace('Check: ', '').toLowerCase();
        if (!ass) {
          addMessage({ kind: 'system', text: `⊘ Check skipped: <${el.tagName.toLowerCase()}> doesn't support a "${checkLabel}" check` });
          showPickerToast(`<${el.tagName.toLowerCase()}> doesn't support a "${checkLabel}" check`, { error: true });
          setRecordSubMode('action');
          return;
        }
        state.assertions.push(ass);
        saveState();
        updateAssertBadge();
        flashElement(el);
        addMessage({ kind: 'system', text: `✓ Check added: ${ass.hint}` });
        showPickerToast(`Check added: ${ass.hint}`);
        setRecordSubMode('action');
        return;
      }

      // For form submission via Enter, the click event won't fire; we
      // catch that case via the submit listener below.
      recordStep('browser_click', { element: describeForAgent(el) });
    },
    { capture: true },
  );

  // Build an assertion {code, hint} pinned to a specific assert kind,
  // mirroring the existing inspectElement() shape so writeSpec consumes
  // it identically. Returns null when the element can't produce that
  // assertion (e.g. assert-value on a <div> with no value).
  function buildRecordingAssertion(el, mode) {
    const sel = bestSelector(el);
    if (!sel) return null;
    let assPart;
    if (mode === 'assert-visible') {
      assPart = { code: 'expect(SEL).toBeVisible()', hint: '· visible' };
    } else if (mode === 'assert-text') {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 200) return null;
      assPart = { code: `expect(SEL).toHaveText(${JSON.stringify(text)})`, hint: `· text "${text.slice(0, 30)}${text.length > 30 ? '…' : ''}"` };
    } else if (mode === 'assert-value') {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'checkbox' || t === 'radio') {
          assPart = el.checked
            ? { code: 'expect(SEL).toBeChecked()', hint: '· is checked' }
            : { code: 'expect(SEL).not.toBeChecked()', hint: '· is unchecked' };
        } else {
          const v = el.value ?? '';
          assPart = { code: `expect(SEL).toHaveValue(${JSON.stringify(v)})`, hint: `· value "${String(v).slice(0, 30)}"` };
        }
      } else if (tag === 'textarea' || tag === 'select') {
        const v = el.value ?? '';
        assPart = { code: `expect(SEL).toHaveValue(${JSON.stringify(v)})`, hint: `· value "${String(v).slice(0, 30)}"` };
      } else {
        return null; // value assertion only makes sense on form fields
      }
    } else {
      return null;
    }
    return {
      code: assPart.code.replace('SEL', sel.code),
      hint: `${sel.hint} ${assPart.hint}`,
    };
  }

  document.addEventListener(
    'submit',
    (e) => {
      if (!recording) return;
      if (recordingPaused) return; // Fix popover open mid-recording
      if (e.composedPath().includes(host)) return;
      flushAllFills();
      // Mirror what happens on Submit click — the submit button (or Enter).
      // The agent's view of this is just a click; emit one for the form's
      // submit button if we can find it.
      const form = e.target;
      if (form instanceof HTMLFormElement) {
        const btn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (btn) recordStep('browser_click', { element: describeForAgent(btn) });
      }
    },
    { capture: true },
  );

  // Track the *original* pre-flash style per element + a single in-flight
  // timer. If flashElement(el) is called again before the previous timer
  // fires, we reuse the original snapshot (don't re-snapshot the mint
  // outline we ourselves just wrote) and reset the timer. Without this,
  // back-to-back flashes on the same element would orphan the mint
  // outline indefinitely.
  const flashOriginal = new WeakMap();
  const flashTimer = new WeakMap();
  function flashElement(el) {
    if (!flashOriginal.has(el)) {
      flashOriginal.set(el, {
        outline: el.style.outline,
        outlineOffset: el.style.outlineOffset,
        transition: el.style.transition,
      });
    }
    const prevTimer = flashTimer.get(el);
    if (prevTimer) clearTimeout(prevTimer);
    el.style.transition = 'outline 0.15s ease';
    el.style.outline = '3px solid #10b981';
    el.style.outlineOffset = '3px';
    const t = setTimeout(() => {
      const orig = flashOriginal.get(el);
      if (orig) {
        el.style.outline = orig.outline;
        el.style.outlineOffset = orig.outlineOffset;
        el.style.transition = orig.transition;
        flashOriginal.delete(el);
      }
      flashTimer.delete(el);
    }, 900);
    flashTimer.set(el, t);
  }

  // ───────────────────────── server event → state mutation ─────────────────────────

  // ───────────────────────── live cost chip ─────────────────────────
  // Surfaces the running session cost in the header so the user can see
  // money tick up during long runs and decide when to hit Stop. There's no
  // server-side budget cap any more — the cost chip is the user's signal.

  const fmtCost = (n) => '$' + (Number(n) || 0).toFixed(4);
  // Use a class instead of the `hidden` attribute so CSS can transition
  // the chip's opacity / transform on appear / disappear (instead of
  // popping in via display: none).
  const showCost = (costUsd, live) => {
    costEl.textContent = fmtCost(costUsd);
    costEl.hidden = false;
    costEl.classList.add('visible');
    costEl.classList.toggle('live', !!live);
  };
  const hideCost = () => {
    costEl.classList.remove('visible', 'live');
    // Defer removal from the layout so the fade-out transition is visible;
    // 220ms matches the CSS opacity transition + a small buffer.
    setTimeout(() => {
      if (!costEl.classList.contains('visible')) costEl.hidden = true;
    }, 220);
  };

  const handleServerEvent = (ev) => {
    // Voice mode: route every event past the TTS layer first. shouldSpeak()
    // owns the policy (which events deserve an utterance, what text to use);
    // langHint tells it whether to use Chinese or English phrasing. The
    // settings.ttsEnabled toggle is checked here (not at speaker construction
    // time) so flipping it in the settings panel takes effect immediately
    // without rebuilding anything.
    if (speaker && settings.ttsEnabled) {
      const decision = shouldSpeak(ev, langHint);
      if (decision.speak && decision.text) speaker.speak(decision.text);
    }
    switch (ev.kind) {
      case 'session_start':
        state.sessionId = ev.sessionId;
        saveState();
        addMessage({
          kind: 'system',
          text: `session ${ev.sessionId.slice(0, 8)} · ${ev.model ?? '?'}`,
        });
        // Fresh session — zero out the live cost chip and let it tick.
        showCost(0, true);
        return;
      case 'mcp_status':
        // Claude Code only reports MCP status once, at system/init — usually
        // "pending" because the MCP child hasn't finished its handshake yet.
        // There is no follow-up "connected" event, so surfacing "pending"
        // looked like a permanent stuck state to users. The actual proof of
        // life is the first mcp__playwright__* tool_use that arrives later.
        // We therefore only surface MCP status when it's NOT a healthy state —
        // "failed", "error", etc. — so the user sees something only when it
        // genuinely matters.
        if (ev.status && ev.status !== 'connected' && ev.status !== 'pending') {
          addMessage({ kind: 'system', text: `⚠ mcp/${ev.server}: ${ev.status}` });
        }
        return;
      case 'usage':
        showCost(ev.costUsd ?? 0, true);
        return;
      case 'tool_use':
        addMessage({
          kind: 'step',
          tool: ev.tool,
          input: ev.input,
          at: Date.now(),
          costUsdSnapshot: ev.costUsdSnapshot,
        });
        return;
      case 'tool_result':
        // On error, retroactively mark the most recent step in state.messages
        // so the grouped renderer picks it up. We don't render here; the next
        // event-driven addMessage (or the explicit renderAll on session_end)
        // will redraw with the updated isError flag.
        if (ev.isError) {
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].kind === 'step') {
              state.messages[i].isError = true;
              scheduleSaveState();
              scheduleRender();
              break;
            }
          }
        }
        return;
      case 'text':
        addMessage({ kind: 'ai', text: ev.text });
        return;
      case 'session_end':
        addMessage({
          kind: 'done',
          turns: ev.turns,
          costUsd: ev.costUsd,
          isError: ev.isError,
          cancelled: ev.cancelled,
          summary: ev.summary,
        });
        // Done card carries the final cost; hide the live chip so the
        // header doesn't display stale running data after the run ends.
        hideCost();
        return;
    }
  };

  // ───────────────────────── WebSocket ─────────────────────────

  let ws = null;
  let backoff = 500;
  let reconnectTimer = null;

  // Plugin host — initialise once we know the panel + root + how to send.
  // wsSend is a closure that captures the latest `ws`; plugins can call
  // host.send(msg) at any time and it falls back to a no-op if the socket
  // isn't open yet (server-side state may not have arrived; plugins should
  // be resilient to that, e.g. retry on their own state).
  const wsSend = (msg) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn('[hover] plugin host wsSend failed:', err);
    }
  };
  const hostCtl = (typeof initHost === 'function')
    ? initHost({ root, panel, wsSend })
    : { applyMode: () => {}, dispatchMessage: () => false };

  const sendLabel = $('.send .send-label');
  const setRunning = (r) => {
    const changed = running !== r;
    running = r;
    const wsReady = ws && ws.readyState === WebSocket.OPEN;
    if (r) {
      sendLabel.textContent = 'Stop';
      sendBtn.classList.add('stop');
      sendBtn.disabled = !wsReady;
      textarea.disabled = true;
      newBtn.disabled = true;
      recordBtn.disabled = true;
      setStatus('running', 'running');
    } else {
      sendLabel.textContent = 'Send';
      sendBtn.classList.remove('stop');
      sendBtn.disabled = !wsReady || recording;
      textarea.disabled = !wsReady || recording;
      newBtn.disabled = false;
      recordBtn.disabled = false;
      if (recording) setStatus('recording', 'running');
      else if (wsReady) setStatus('ready', 'connected');
    }
    // Toggling running affects whether the trailing group is rendered as
    // live (spinner, auto-expand) or closed (chevron collapsed, Save-as
    // chip on the final group). Redraw so the user sees the transition.
    if (changed) renderAll();
  };

  const detachWs = (sock) => {
    if (!sock) return;
    sock.onopen = null;
    sock.onclose = null;
    sock.onerror = null;
    sock.onmessage = null;
  };

  const connect = () => {
    // Unbind the previous socket's handlers before swapping the reference,
    // so a late 'close' on the old socket can't schedule a second reconnect
    // or mutate UI state for the new connection.
    detachWs(ws);
    setStatus('connecting…', 'disconnected');
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    const sock = ws;
    sock.onopen = () => {
      if (sock !== ws) return;
      backoff = 500;
      setStatus('ready', 'connected');
      sendBtn.disabled = running;
      textarea.disabled = running;
      // Ask the service whether we're in the debug Chrome. Until we hear
      // back, cdpState stays 'unknown' (overlay hidden, launcher normal).
      sendCheckCdp();
      // Now that the page is alive and we know we'll likely be using the
      // widget, kick off the voiceschanged race so the first utterance
      // doesn't trip into a wrong-language voice.
      primeVoices();
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      setStatus('disconnected', 'disconnected');
      sendBtn.disabled = true;
      textarea.disabled = true;
      scheduleReconnect();
    };
    sock.onerror = () => {
      try { sock.close(); } catch {}
    };
    sock.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      // v0.12 — plugin-contributed save flows. Routed first so that a
      // plugin-save error doesn't trigger setRunning(false) below (saves
      // don't go through the session lifecycle).
      if (tryHandlePluginSave(msg)) return;
      if (msg.type === 'event' && msg.payload) {
        handleServerEvent(msg.payload);
        if (msg.payload.kind === 'session_end') setRunning(false);
      } else if (msg.type === 'error') {
        addMessage({ kind: 'system', text: `error: ${msg.payload?.message ?? 'unknown'}` });
        setRunning(false);
      } else if (msg.type === 'skill-saved') {
        handleArtifactSaved('skill', msg.payload ?? {});
      } else if (msg.type === 'skill-exists') {
        const p = msg.payload ?? {};
        handleArtifactExists('skill', p.slug, p.existingPath);
      } else if (msg.type === 'spec-saved') {
        handleArtifactSaved('spec', msg.payload ?? {});
      } else if (msg.type === 'spec-exists') {
        const p = msg.payload ?? {};
        handleArtifactExists('spec', p.slug, p.existingPath);
      } else if (msg.type === 'case-csv-saved') {
        handleArtifactSaved('case-csv', msg.payload ?? {});
      } else if (msg.type === 'case-csv-exists') {
        const p = msg.payload ?? {};
        handleArtifactExists('case-csv', p.slug, p.existingPath);
      } else if (msg.type === 'skills-list') {
        renderSkills(msg.payload?.skills ?? []);
      } else if (msg.type === 'specs-list') {
        renderSpecs(msg.payload?.specs ?? []);
      } else if (msg.type === 'optimize-result') {
        const p = msg.payload ?? {};
        if (optimizing && optimizing.slug === p.slug) {
          optimizing = { slug: p.slug, status: 'ready', candidate: p.candidate, original: p.original };
          renderSpecs(lastSpecs);
        }
      } else if (msg.type === 'optimize-failed') {
        const p = msg.payload ?? {};
        optimizing = null;
        addMessage({ kind: 'system', text: `✗ Optimize failed: ${p.reason ?? 'unknown'}` });
        renderSpecs(lastSpecs);
      } else if (msg.type === 'optimized-promoted') {
        addMessage({ kind: 'system', text: `✓ Promoted optimized spec: ${msg.payload?.slug ?? ''}` });
        requestSpecsList();
      } else if (msg.type === 'optimized-discarded') {
        addMessage({ kind: 'system', text: `Kept original spec: ${msg.payload?.slug ?? ''}` });
      } else if (msg.type === 'cdp-status') {
        const p = msg.payload ?? {};
        const launching = p.launching === true;
        applyCdpState(p.state ?? 'unknown', { launching });
        // After a launch attempt finishes, restore textarea/sendBtn enablement
        // for the same-window case (the gate logic only disables; coming back
        // to a working state needs an explicit re-enable here).
        if (!launching && (p.state === 'same-window' || p.state === 'unknown')) {
          if (wsOpen() && !running && !recording) {
            sendBtn.disabled = false;
            textarea.disabled = false;
          }
        }
      } else if (msg.type === 'hello') {
        // Server tells us its currently-selected agent on every connect.
        // We may have a remembered preference in localStorage (state.currentAgent);
        // if it differs, ask the server to switch. The server's choice is
        // authoritative for the visual label until that round-trip completes.
        const serverAgent = msg.payload?.agentId;
        if (serverAgent) {
          const remembered = state.currentAgent;
          state.currentAgent = serverAgent;
          renderAgentButton();
          if (remembered && remembered !== serverAgent) {
            // Defer until after `agents` lands so the server has the
            // availability cache ready and we don't race the switch.
            setTimeout(() => switchAgent(remembered), 50);
          }
        }
      } else if (msg.type === 'agents') {
        const p = msg.payload ?? {};
        if (typeof p.current === 'string') state.currentAgent = p.current;
        if (Array.isArray(p.available)) state.availableAgents = p.available;
        renderAgentButton();
        if (agentsOverlay.classList.contains('open')) renderAgentsOverlay();
        saveState();
      } else if (msg.type === 'modes') {
        // Plugin-contributed mode catalogue. `current` may be null
        // (default/unmoded). `available` is the list of plugin-contributed
        // modes; empty when no plugins are loaded — pill stays hidden.
        const p = msg.payload ?? {};
        state.currentMode = typeof p.current === 'string' ? p.current : null;
        state.availableModes = Array.isArray(p.available) ? p.available : [];
        renderModeButton();
        if (modesOverlay.classList.contains('open')) renderModesOverlay();
        // Default mode owns its own widgets — hide them when a plugin
        // mode takes over, show them again on return. Plugins don't need
        // to know default's selectors; default listens for itself.
        applyDefaultModeVisibility(state.currentMode);
        // Plugin host: install / tear down plugin UI contributions (CSS,
        // toolbar buttons, overlays, plugin-internal DOM mutations).
        // Idempotent — same mode = no-op.
        hostCtl.applyMode(state.currentMode);
      } else {
        // Plugin-namespaced messages (any `<plugin>:<event>` shape) are
        // routed to the plugin's registered onMessage handler. The WS
        // protocol has too many one-off types (skill-saved, spec-exists,
        // agents, …) that legitimately fall through here, so we don't
        // log unmatched messages.
        hostCtl.dispatchMessage(msg);
      }
    };
  };

  const scheduleReconnect = () => {
    if (reconnectTimer != null) return; // already scheduled
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 1.7, 10000);
  };

  // ───────────────────────── submit handler ─────────────────────────

  const submit = () => {
    const text = textarea.value.trim();
    if (!text || running || !ws || ws.readyState !== WebSocket.OPEN) return;
    // Block sends when this widget isn't bound to the debug Chrome — the
    // service can't drive a tab it can't see over CDP.
    if (cdpState === 'wrong-window' || cdpState === 'no-cdp' || cdpLaunching) return;
    // Keep langHint in sync with the user's latest message so TTS narration
    // for this run stays in the right language even if the agent replies
    // English to a Chinese prompt.
    langHint = detectLanguage(text);
    addMessage({ kind: 'user', text });
    textarea.value = '';
    setRunning(true);
    // Include sessionId so the service can pass --resume to claude. Server
    // ignores it if the agent doesn't support resume.
    ws.send(JSON.stringify({
      type: 'command',
      payload: { text, sessionId: state.sessionId ?? undefined },
    }));
  };

  const cancelRunning = () => {
    if (!running || !ws || ws.readyState !== WebSocket.OPEN) return;
    sendBtn.disabled = true; // until server acks with session_end
    // Drop the TTS queue so a stop press doesn't leave the speaker mid-
    // sentence — the session_end (cancelled) event will say "Stopped."
    speaker?.cancel();
    ws.send(JSON.stringify({ type: 'cancel' }));
  };

  sendBtn.addEventListener('click', () => (running ? cancelRunning() : submit()));
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  // ───────────────────────── boot ─────────────────────────

  loadState();
  replayState();
  updateAssertBadge();

  // If the last persisted message wasn't a 'done' card, the previous session
  // was interrupted (most commonly: AI navigated to a same-origin URL → page
  // reload destroyed the widget mid-stream). Surface a transient note so the
  // user knows the agent run may not have finished. Not persisted — only
  // shown once per boot.
  const lastMsg = state.messages[state.messages.length - 1];
  if (lastMsg && lastMsg.kind !== 'done') {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.style.color = '#d97706';
    div.textContent = '↻ resumed — previous run may have been interrupted by a page reload.';
    bodyEl.appendChild(div);
    scrollToBottom();
  }

  // Restore the panel open/closed state last so the user sees what they were
  // looking at before the reload.
  if (state.open) setOpen(true);

  connect();
})();
