// Hover widget — injected by @hover/vite-plugin into the user's dev page.
// Plain JS (no transpilation), self-isolating via Shadow DOM.
// Marked with data-hover="true" so future Playwright runs can skip it.

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

  root.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }

      .launcher {
        position: fixed; bottom: 24px; right: 24px;
        width: 48px; height: 48px;
        border-radius: 50%; border: none; cursor: pointer;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff;
        box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; padding: 0;
        font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        z-index: 2147483647;
      }
      .launcher:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5); }
      .launcher.open { transform: rotate(45deg); }

      .panel {
        position: fixed; bottom: 88px; right: 24px;
        width: 420px; height: 560px;
        max-height: calc(100vh - 120px);
        background: #fff; border-radius: 12px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
        display: flex; flex-direction: column; overflow: hidden;
        font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
        color: #111;
        opacity: 0; pointer-events: none; transform: translateY(8px);
        transition: opacity 0.15s ease, transform 0.15s ease;
        z-index: 2147483647;
      }
      .panel.open { opacity: 1; pointer-events: auto; transform: translateY(0); }

      header {
        padding: 10px 14px; border-bottom: 1px solid #eee;
        display: flex; align-items: center; gap: 8px;
      }
      .title { font-weight: 600; font-size: 14px; flex: 1; }
      .status {
        font-size: 11px; padding: 2px 8px;
        border-radius: 999px; font-weight: 500;
        background: #fef3c7; color: #92400e;
      }
      .status.connected { background: #d1fae5; color: #065f46; }
      .status.disconnected { background: #fee2e2; color: #991b1b; }
      .status.running { background: #dbeafe; color: #1e40af; }

      .iconbtn {
        border: 1px solid #e5e7eb; background: #fff;
        border-radius: 6px; width: 24px; height: 24px;
        font-size: 13px; line-height: 1; color: #6b7280;
        cursor: pointer; padding: 0;
        display: flex; align-items: center; justify-content: center;
      }
      .iconbtn:hover { background: #f3f4f6; color: #111; }
      .iconbtn:disabled { opacity: 0.4; cursor: not-allowed; }
      .iconbtn.active { background: #eef2ff; border-color: #c7d2fe; color: #4338ca; }
      .iconbtn.assertbtn[hidden] { display: none; }
      .iconbtn.assertbtn {
        width: auto; padding: 0 8px;
        background: #ecfdf5; border-color: #a7f3d0; color: #047857;
        gap: 4px; font-size: 11px; font-weight: 600;
      }
      .iconbtn.assertbtn:hover { background: #d1fae5; border-color: #6ee7b7; }
      .iconbtn.assertbtn .assert-glyph { font-size: 12px; }
      .iconbtn.assertbtn .assert-count { font-variant-numeric: tabular-nums; }

      /* Skills overlay slides over the body+footer area. Panel itself is
         position:fixed, so absolute children align to it. */
      .skills-overlay {
        position: absolute; top: 41px; left: 0; right: 0; bottom: 0;
        background: #fff;
        display: none;
        flex-direction: column;
        z-index: 5;
      }
      .skills-overlay.open { display: flex; }
      .skills-overlay .skills-header {
        padding: 10px 14px; border-bottom: 1px solid #eee;
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: #6b7280;
      }
      .skills-overlay .skills-header .count {
        font-weight: 600; color: #111;
      }
      .skills-overlay .skills-list-items {
        flex: 1; overflow-y: auto; padding: 8px;
      }
      .skills-overlay .skills-empty {
        padding: 20px 16px; text-align: center;
        color: #9ca3af; font-size: 12px; line-height: 1.5;
      }
      .skill-row {
        padding: 10px 12px; border-radius: 8px;
        cursor: pointer; margin-bottom: 4px;
        border: 1px solid transparent;
      }
      .skill-row:hover { background: #f9fafb; border-color: #e5e7eb; }
      .skill-row .skill-name { font-weight: 600; color: #111; font-size: 13px; }
      .skill-row .skill-desc {
        font-size: 12px; color: #6b7280; margin-top: 2px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .skill-row .skill-slug {
        font-size: 11px; color: #9ca3af; margin-top: 2px;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
      }

      .body {
        flex: 1; padding: 14px; overflow-y: auto;
        font-size: 13px; color: #333; line-height: 1.5;
        background: #fafafa;
      }
      .body:empty::before {
        content: "Describe what you want to verify, e.g. \\"test the login flow\\".";
        color: #999;
        font-style: italic;
      }

      .msg { margin-bottom: 10px; }
      .msg .label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
      .msg.user .bubble { background: #6366f1; color: #fff; padding: 8px 12px; border-radius: 10px 10px 2px 10px; display: inline-block; max-width: 100%; word-wrap: break-word; }
      .msg.user { text-align: right; }

      .msg.step {
        background: #fff; border: 1px solid #e5e7eb;
        border-radius: 8px; padding: 8px 10px;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 12px; color: #374151;
      }
      .msg.step.error { border-color: #fca5a5; background: #fef2f2; }
      .msg.step .tool { font-weight: 600; color: #6366f1; }
      .msg.step .args { color: #6b7280; word-break: break-all; }
      .msg.step .arrow { color: #9ca3af; margin-right: 4px; }

      .msg.ai .bubble { background: #fff; border: 1px solid #e5e7eb; padding: 8px 12px; border-radius: 10px 10px 10px 2px; display: inline-block; max-width: 100%; word-wrap: break-word; white-space: pre-wrap; }
      .msg.ai .bubble strong { font-weight: 600; }
      .msg.ai .bubble em { font-style: italic; }
      .msg.ai .bubble code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }

      .msg.system { font-size: 11px; color: #9ca3af; font-style: italic; }

      .msg.done {
        background: #f0fdf4; border: 1px solid #bbf7d0;
        border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #166534;
      }
      .msg.done.error { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
      .msg.done .meta { font-weight: 600; margin-bottom: 4px; }
      .msg.done .summary { color: inherit; opacity: 0.9; white-space: pre-wrap; }
      .msg.done .actions { margin-top: 8px; display: flex; gap: 6px; }
      .msg.done .actions button {
        font-size: 11px; padding: 4px 10px;
        border-radius: 6px; border: 1px solid #86efac;
        background: #fff; color: #166534;
        cursor: pointer;
      }
      .msg.done .actions button:hover { background: #f0fdf4; }
      .msg.done .actions button:disabled { opacity: 0.5; cursor: not-allowed; }

      footer {
        border-top: 1px solid #eee; padding: 10px;
        display: flex; flex-direction: column; gap: 8px;
        background: #fff;
      }
      textarea {
        width: 100%; resize: none;
        border: 1px solid #ddd; border-radius: 6px;
        padding: 8px; font-family: inherit; font-size: 13px;
        outline: none; color: #111;
      }
      textarea:focus { border-color: #6366f1; }
      textarea:disabled { background: #fafafa; color: #999; cursor: not-allowed; }

      .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .hint { font-size: 11px; color: #888; }
      .send {
        padding: 6px 14px; border-radius: 6px; border: none;
        background: #6366f1; color: #fff;
        font-size: 13px; font-weight: 500; cursor: pointer;
      }
      .send:hover:not(:disabled) { background: #4f46e5; }
      .send:disabled { background: #cbd5e1; cursor: not-allowed; }
      .send.stop { background: #dc2626; cursor: pointer; }
      .send.stop:hover { background: #b91c1c; }
      .send.stop:disabled { background: #cbd5e1; cursor: not-allowed; }

      .record-btn {
        background: transparent;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        color: #6b7280;
        cursor: pointer;
        font-family: inherit;
        display: inline-flex; align-items: center; gap: 4px;
      }
      .record-btn:hover { color: #dc2626; border-color: #fca5a5; background: #fef2f2; }
      .record-btn .rec-dot {
        display: inline-block;
        width: 6px; height: 6px;
        border-radius: 50%;
        background: #dc2626;
      }
      .record-btn.recording {
        background: #fee2e2;
        color: #dc2626;
        border-color: #fca5a5;
        font-weight: 600;
      }
      .record-btn.recording .rec-dot { animation: rec-pulse 1.2s ease-in-out infinite; }
      @keyframes rec-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.7); }
      }
    </style>

    <button class="launcher" type="button" aria-label="Open Hover" aria-expanded="false">&#x2728;</button>

    <div class="panel" role="dialog" aria-label="Hover">
      <header>
        <span class="title">Hover</span>
        <button class="iconbtn skillsbtn" type="button" aria-label="Skills" title="Saved skills">📚</button>
        <button class="iconbtn assertbtn" type="button" hidden aria-label="Pending assertions" title="Pending assertions — click to clear">
          <span class="assert-glyph">✓</span><span class="assert-count">0</span>
        </button>
        <button class="iconbtn newbtn" type="button" aria-label="New conversation" title="New conversation (clears history)">+</button>
        <span class="status disconnected">connecting…</span>
      </header>
      <div class="body" aria-live="polite"></div>

      <div class="skills-overlay" aria-hidden="true">
        <div class="skills-header">
          Saved skills · <span class="count">0</span>
          <span style="flex:1"></span>
          <button class="iconbtn skills-close" type="button" aria-label="Close skills">×</button>
        </div>
        <div class="skills-list-items"></div>
      </div>
      <footer>
        <textarea placeholder="e.g. test the login flow" rows="3" disabled aria-label="instruction"></textarea>
        <div class="row">
          <span class="hint">⏎ send · ⌥/Alt + click any page element to assert</span>
          <button type="button" class="record-btn" aria-label="record manual interactions" title="Record your own clicks/typing on the page">
            <span class="rec-dot"></span><span class="rec-label">Record</span>
          </button>
          <button type="button" class="send" disabled>Send</button>
        </div>
      </footer>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const launcher = $('.launcher');
  const panel = $('.panel');
  const statusEl = $('.status');
  const newBtn = $('.newbtn');
  const skillsBtn = $('.skillsbtn');
  const skillsOverlay = $('.skills-overlay');
  const skillsListEl = $('.skills-list-items');
  const skillsCountEl = $('.skills-overlay .count');
  const skillsCloseBtn = $('.skills-close');
  const assertBtn = $('.assertbtn');
  const assertCountEl = $('.assert-count');
  const recordBtn = $('.record-btn');
  const recLabel = $('.rec-label');
  const bodyEl = $('.body');
  const textarea = $('textarea');
  const sendBtn = $('.send');

  // ───────────────────────── persistent state ─────────────────────────
  // Survives panel close, page reload, and AI-driven navigations within
  // localhost. Schema is `v1` — bump STORAGE_KEY if shape changes.
  //
  //   messages: ordered list of semantic messages (not HTML)
  //   sessionId: most recent agent session id, used to --resume on next send

  const state = { messages: [], sessionId: null, open: false, assertions: [] };

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / privacy mode — degrade silently */
    }
  };

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

  // Esc inside shadow → close. We listen on the shadow root, not document,
  // so a stray Esc on the host page (or AI key input) doesn't dismiss us.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  // ───────────────────────── rendering ─────────────────────────

  const scrollToBottom = () => {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };

  const renderUser = (text) => {
    const div = document.createElement('div');
    div.className = 'msg user';
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = text;
    div.appendChild(b);
    bodyEl.appendChild(div);
    scrollToBottom();
  };

  const renderSystem = (text) => {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    bodyEl.appendChild(div);
    scrollToBottom();
  };

  let lastStepDiv = null;
  const renderStep = (msg) => {
    const div = document.createElement('div');
    div.className = 'msg step' + (msg.isError ? ' error' : '');
    const argStr = JSON.stringify(msg.input ?? {});
    const short = argStr.length > 80 ? argStr.slice(0, 77) + '…' : argStr;
    div.innerHTML = `
      <span class="arrow">→</span>
      <span class="tool"></span>
      <span class="args"></span>
    `;
    div.querySelector('.tool').textContent = msg.tool;
    div.querySelector('.args').textContent = ' ' + short;
    bodyEl.appendChild(div);
    lastStepDiv = div;
    scrollToBottom();
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

  const renderAi = (text) => {
    const div = document.createElement('div');
    div.className = 'msg ai';
    const b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = renderMarkdownLite(text);
    div.appendChild(b);
    bodyEl.appendChild(div);
    scrollToBottom();
  };

  const renderDone = (msg) => {
    const div = document.createElement('div');
    div.className = 'msg done' + (msg.isError ? ' error' : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const turns = msg.turns != null ? `${msg.turns} turn${msg.turns === 1 ? '' : 's'}` : 'done';
    const cost = msg.costUsd != null ? ` · $${msg.costUsd.toFixed(4)}` : '';
    meta.textContent = (msg.isError ? '✗ ' : '✓ ') + turns + cost;
    div.appendChild(meta);
    if (msg.summary) {
      const s = document.createElement('div');
      s.className = 'summary';
      s.textContent = msg.summary;
      div.appendChild(s);
    }

    // Save-as-Skill / Save-as-Spec buttons on successful runs. Always saves
    // the most recent session (last 'user' → end of state.messages),
    // regardless of which done card it lives on.
    if (!msg.isError) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      const saveSkillBtn = document.createElement('button');
      saveSkillBtn.type = 'button';
      saveSkillBtn.textContent = '💾 Save as Skill';
      saveSkillBtn.addEventListener('click', () => saveSkillFromLastSession(saveSkillBtn));
      actions.appendChild(saveSkillBtn);
      const saveSpecBtn = document.createElement('button');
      saveSpecBtn.type = 'button';
      saveSpecBtn.textContent = '📜 Save as spec';
      saveSpecBtn.addEventListener('click', () => saveSpecFromLastSession(saveSpecBtn));
      actions.appendChild(saveSpecBtn);
      div.appendChild(actions);
    }

    bodyEl.appendChild(div);
    scrollToBottom();
  };

  const renderMessage = (msg) => {
    switch (msg.kind) {
      case 'user':   return renderUser(msg.text);
      case 'system': return renderSystem(msg.text);
      case 'step':   return renderStep(msg);
      case 'ai':     return renderAi(msg.text);
      case 'done':   return renderDone(msg);
    }
  };

  // Append a serialized message: push to state + render + persist.
  const addMessage = (msg) => {
    state.messages.push(msg);
    if (state.messages.length > MESSAGE_CAP) state.messages.shift();
    saveState();
    renderMessage(msg);
  };

  // Restore all stored messages on init (no re-persist, no DOM re-flow).
  const replayState = () => {
    bodyEl.innerHTML = '';
    lastStepDiv = null;
    for (const m of state.messages) renderMessage(m);
  };

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
  let pendingSave = null;
  let pendingSpec = null;

  const saveSkillFromLastSession = (button) => {
    const steps = lastSessionSlice();
    if (steps.length === 0 || !steps.some((s) => s.kind === 'step')) {
      addMessage({ kind: 'system', text: 'Nothing to save (no tool steps in the last session).' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }

    const name = prompt('Skill name (kebab-case suggested, e.g. "login-as-claude"):', '');
    if (name == null || !name.trim()) return;
    const description = prompt('One-line description (optional):', '') ?? '';

    pendingSave = { name: name.trim(), description: description.trim(), steps, button };

    button.disabled = true;
    button.textContent = 'Saving…';
    ws.send(JSON.stringify({
      type: 'save-skill',
      payload: { name: pendingSave.name, description: pendingSave.description, steps },
    }));

    setTimeout(() => {
      if (button.textContent === 'Saving…') {
        button.disabled = false;
        button.textContent = '💾 Save as Skill';
      }
    }, 8000);
  };

  // ───────────────────────── skills overlay ─────────────────────────

  const requestSkillsList = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'list-skills' }));
    }
  };

  const renderSkills = (skills) => {
    skillsCountEl.textContent = String(skills.length);
    skillsListEl.innerHTML = '';
    if (skills.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'skills-empty';
      empty.textContent = 'No saved skills yet. Run a session, then click 💾 Save as Skill on the result card.';
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

  const openSkillsOverlay = () => {
    skillsOverlay.classList.add('open');
    skillsOverlay.setAttribute('aria-hidden', 'false');
    skillsBtn.classList.add('active');
    requestSkillsList();
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

  const saveSpecFromLastSession = (button) => {
    const steps = lastSessionSlice();
    if (steps.length === 0 || !steps.some((s) => s.kind === 'step')) {
      addMessage({ kind: 'system', text: 'Nothing to save (no tool steps in the last session).' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }
    const name = prompt('Spec name (kebab-case suggested, e.g. "login-flow"):', '');
    if (name == null || !name.trim()) return;
    const description = prompt('One-line description (optional):', '') ?? '';

    pendingSpec = {
      name: name.trim(),
      description: description.trim(),
      steps,
      assertions: state.assertions.slice(),
      button,
    };
    button.disabled = true;
    button.textContent = 'Saving…';
    ws.send(JSON.stringify({
      type: 'save-spec',
      payload: {
        name: pendingSpec.name,
        description: pendingSpec.description,
        steps,
        assertions: pendingSpec.assertions,
      },
    }));

    setTimeout(() => {
      if (button.textContent === 'Saving…') {
        button.disabled = false;
        button.textContent = '📜 Save as spec';
      }
    }, 8000);
  };

  const handleSpecExists = (slug, existingPath) => {
    if (!pendingSpec) return;
    const overwrite = confirm(
      `Spec "${slug}" already exists:\n${existingPath}\n\nOverwrite the existing file?`,
    );
    if (overwrite) {
      ws.send(JSON.stringify({
        type: 'save-spec',
        payload: {
          name: pendingSpec.name,
          description: pendingSpec.description,
          steps: pendingSpec.steps,
          assertions: pendingSpec.assertions,
          overwrite: true,
        },
      }));
      return;
    }
    if (pendingSpec.button) {
      pendingSpec.button.disabled = false;
      pendingSpec.button.textContent = '📜 Save as spec';
    }
    addMessage({ kind: 'system', text: `Skipped overwrite of "${slug}".` });
    pendingSpec = null;
  };

  const handleSkillExists = (slug, existingPath) => {
    if (!pendingSave) return;
    const overwrite = confirm(
      `Skill "${slug}" already exists:\n${existingPath}\n\nOverwrite the existing file?`,
    );
    if (overwrite) {
      ws.send(JSON.stringify({
        type: 'save-skill',
        payload: {
          name: pendingSave.name,
          description: pendingSave.description,
          steps: pendingSave.steps,
          overwrite: true,
        },
      }));
      // Keep pendingSave so the eventual skill-saved ack hits the same button.
      return;
    }
    // Cancelled — restore the button and clear pending state
    if (pendingSave.button) {
      pendingSave.button.disabled = false;
      pendingSave.button.textContent = '💾 Save as Skill';
    }
    addMessage({ kind: 'system', text: `Skipped overwrite of "${slug}".` });
    pendingSave = null;
  };

  // ───────────────────────── status + new conversation ─────────────────────────

  const setStatus = (text, cls) => {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`;
  };

  newBtn.addEventListener('click', () => {
    if (state.messages.length === 0 && !state.sessionId && state.assertions.length === 0) return;
    if (!confirm('Start a new conversation? Current history and assertions will be cleared.')) return;
    state.messages = [];
    state.sessionId = null;
    state.assertions = [];
    saveState();
    bodyEl.innerHTML = '';
    lastStepDiv = null;
    updateAssertBadge();
  });

  // ───────────────────────── Alt-click "Assert This" ─────────────────
  //
  // While the panel is open, holding Alt and clicking any element in the
  // host page produces an assertion derived from that element's current
  // state. Click is intercepted in the capture phase so the host app's
  // own handler does not fire. Assertions accumulate in state.assertions
  // and ship out with the next Save as Spec.

  const updateAssertBadge = () => {
    const n = state.assertions.length;
    if (n === 0) {
      assertBtn.hidden = true;
    } else {
      assertBtn.hidden = false;
      assertCountEl.textContent = String(n);
    }
  };

  assertBtn.addEventListener('click', () => {
    if (state.assertions.length === 0) return;
    if (!confirm(`Clear all ${state.assertions.length} pending assertion${state.assertions.length === 1 ? '' : 's'}?`)) return;
    state.assertions = [];
    saveState();
    updateAssertBadge();
    addMessage({ kind: 'system', text: 'Cleared pending assertions.' });
  });

  document.addEventListener(
    'click',
    (e) => {
      if (!e.altKey) return;
      if (!isOpen()) return;
      // Skip clicks inside our own widget.
      if (e.composedPath().includes(host)) return;

      e.preventDefault();
      e.stopPropagation();

      const target = e.target;
      if (!(target instanceof Element) || target === document.documentElement || target === document.body) return;

      const ass = inspectElement(target);
      if (!ass) {
        addMessage({ kind: 'system', text: `⊘ Alt-click ignored: ${target.tagName.toLowerCase()} has no usable identity` });
        return;
      }
      state.assertions.push(ass);
      saveState();
      updateAssertBadge();
      flashElement(target);
      addMessage({ kind: 'system', text: `✓ Asserted: ${ass.hint}` });
    },
    { capture: true },
  );

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

  let recording = false;
  let recordStartIdx = 0;
  const pendingFills = new Map(); // element → last seen value

  const setRecording = (on) => {
    recording = on;
    if (on) {
      recordBtn.classList.add('recording');
      recLabel.textContent = 'Stop';
      // Send/textarea become inert while recording.
      sendBtn.disabled = true;
      textarea.disabled = true;
      addMessage({ kind: 'user', text: '(recording manual interactions)' });
      recordStartIdx = state.messages.length;
    } else {
      recordBtn.classList.remove('recording');
      recLabel.textContent = 'Record';
      flushAllFills();
      const wsReady = ws && ws.readyState === WebSocket.OPEN;
      sendBtn.disabled = !wsReady;
      textarea.disabled = !wsReady;
      const captured = state.messages.slice(recordStartIdx).filter(m => m.kind === 'step').length;
      addMessage({
        kind: 'done',
        turns: captured,
        costUsd: 0,
        summary: `Recorded ${captured} action${captured === 1 ? '' : 's'}. Click Save as Skill / Spec on this card to keep it.`,
      });
    }
  };

  recordBtn.addEventListener('click', () => {
    if (running) return;
    setRecording(!recording);
  });

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
      if (e.altKey) return; // Alt-click is "Assert This", not record
      if (e.composedPath().includes(host)) return;
      const el = e.target;
      if (!(el instanceof Element)) return;

      // Flush any text input the user was typing in before this click
      flushAllFills();

      // For form submission via Enter, the click event won't fire; we
      // catch that case via the submit listener below.
      recordStep('browser_click', { element: describeForAgent(el) });
    },
    { capture: true },
  );

  document.addEventListener(
    'submit',
    (e) => {
      if (!recording) return;
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

  function flashElement(el) {
    const old = {
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      transition: el.style.transition,
    };
    el.style.transition = 'outline 0.15s ease';
    el.style.outline = '3px solid #10b981';
    el.style.outlineOffset = '3px';
    setTimeout(() => {
      el.style.outline = old.outline;
      el.style.outlineOffset = old.outlineOffset;
      el.style.transition = old.transition;
    }, 900);
  }

  // ───────────────────────── server event → state mutation ─────────────────────────

  const handleServerEvent = (ev) => {
    switch (ev.kind) {
      case 'session_start':
        state.sessionId = ev.sessionId;
        saveState();
        addMessage({
          kind: 'system',
          text: `session ${ev.sessionId.slice(0, 8)} · ${ev.model ?? '?'}`,
        });
        return;
      case 'mcp_status':
        addMessage({ kind: 'system', text: `mcp/${ev.server}: ${ev.status}` });
        return;
      case 'tool_use':
        addMessage({ kind: 'step', tool: ev.tool, input: ev.input });
        return;
      case 'tool_result':
        if (ev.isError && lastStepDiv) {
          lastStepDiv.classList.add('error');
          // also mutate the persisted step so reload reflects the error state
          for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i].kind === 'step') {
              state.messages[i].isError = true;
              saveState();
              break;
            }
          }
        }
        lastStepDiv = null;
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
          summary: ev.summary,
        });
        return;
    }
  };

  // ───────────────────────── WebSocket ─────────────────────────

  let ws = null;
  let backoff = 500;
  let running = false;

  const setRunning = (r) => {
    running = r;
    const wsReady = ws && ws.readyState === WebSocket.OPEN;
    if (r) {
      sendBtn.textContent = 'Stop';
      sendBtn.classList.add('stop');
      sendBtn.disabled = !wsReady;
      textarea.disabled = true;
      newBtn.disabled = true;
      recordBtn.disabled = true;
      setStatus('running', 'running');
    } else {
      sendBtn.textContent = 'Send';
      sendBtn.classList.remove('stop');
      sendBtn.disabled = !wsReady || recording;
      textarea.disabled = !wsReady || recording;
      newBtn.disabled = false;
      recordBtn.disabled = false;
      if (recording) setStatus('recording', 'running');
      else if (wsReady) setStatus('connected', 'connected');
    }
  };

  const connect = () => {
    setStatus('connecting…', 'disconnected');
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => {
      backoff = 500;
      setStatus('connected', 'connected');
      sendBtn.disabled = running;
      textarea.disabled = running;
    });
    ws.addEventListener('close', () => {
      setStatus('disconnected', 'disconnected');
      sendBtn.disabled = true;
      textarea.disabled = true;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch {}
    });
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'event' && msg.payload) {
        handleServerEvent(msg.payload);
        if (msg.payload.kind === 'session_end') setRunning(false);
      } else if (msg.type === 'error') {
        addMessage({ kind: 'system', text: `error: ${msg.payload?.message ?? 'unknown'}` });
        setRunning(false);
      } else if (msg.type === 'skill-saved') {
        const p = msg.payload ?? {};
        addMessage({
          kind: 'system',
          text: `✓ saved skill "${p.name}" → ${p.path}\n  try: "execute ${p.name}" in a new conversation`,
        });
        // Re-arm any saving buttons in the panel
        root.querySelectorAll('.msg.done .actions button').forEach((b) => {
          if (b.textContent === 'Saving…') {
            b.disabled = false;
            b.textContent = '💾 Save as Skill';
          }
        });
      } else if (msg.type === 'skill-exists') {
        const p = msg.payload ?? {};
        handleSkillExists(p.slug, p.existingPath);
      } else if (msg.type === 'spec-saved') {
        const p = msg.payload ?? {};
        const n = pendingSpec?.assertions?.length ?? 0;
        addMessage({
          kind: 'system',
          text: `✓ saved Playwright spec "${p.name}"${n > 0 ? ` (+${n} assertion${n === 1 ? '' : 's'})` : ''} → ${p.path}\n  run it: pnpm test:e2e`,
        });
        root.querySelectorAll('.msg.done .actions button').forEach((b) => {
          if (b.textContent === 'Saving…') {
            b.disabled = false;
            b.textContent = '📜 Save as spec';
          }
        });
        // Saved successfully — assertions are now baked into the file, clear them
        state.assertions = [];
        saveState();
        updateAssertBadge();
        pendingSpec = null;
      } else if (msg.type === 'spec-exists') {
        const p = msg.payload ?? {};
        handleSpecExists(p.slug, p.existingPath);
      } else if (msg.type === 'skills-list') {
        renderSkills(msg.payload?.skills ?? []);
      } else if (msg.type === 'hello') {
        // handshake — could surface agentId/model later
      }
    });
  };

  const scheduleReconnect = () => {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.7, 10000);
  };

  // ───────────────────────── submit handler ─────────────────────────

  const submit = () => {
    const text = textarea.value.trim();
    if (!text || running || !ws || ws.readyState !== WebSocket.OPEN) return;
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
