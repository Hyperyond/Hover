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
  const costEl = $('.cost');

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
    const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
    const tool = document.createElement('span'); tool.className = 'tool'; tool.textContent = msg.tool;
    const args = document.createElement('span'); args.className = 'args'; args.textContent = ' ' + short;
    div.appendChild(arrow);
    div.appendChild(tool);
    div.appendChild(args);
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

    // Save dropdown on successful runs. One trigger button, three menu
    // items — one per artifact format the saved session can crystallise
    // into. Always saves the most recent session (last 'user' → end of
    // state.messages), regardless of which done card it lives on.
    if (!msg.isError) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.appendChild(buildSaveDropdown());
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

  // ───────────────────────── save dropdown ─────────────────────────
  //
  // One trigger button per done card; the menu lists the three artifact
  // formats. Each menu item delegates to the same save* function that
  // used to be wired to its own button, passing the trigger so the
  // Saving…/restore flow has something to update.

  const TRIGGER_LABEL_HTML = '<span class="trigger-label">💾 Save as</span><span class="caret">▾</span>';

  const restoreTrigger = (b) => {
    b.disabled = false;
    b.innerHTML = TRIGGER_LABEL_HTML;
  };

  function buildSaveDropdown() {
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

    const items = [
      {
        icon: '📜', label: 'Playwright spec',
        sub: '__vibe_tests__/<slug>.spec.ts · for CI',
        cls: 'item-spec',
        run: () => saveSpecFromLastSession(trigger),
      },
      {
        icon: '💾', label: 'Claude Code Skill',
        sub: '.claude/skills/<slug>/SKILL.md · for future agent replay',
        cls: 'item-skill',
        run: () => saveSkillFromLastSession(trigger),
      },
      {
        icon: '📋', label: 'Jira test case (CSV)',
        sub: '__vibe_tests__/<slug>.case.csv · for Xray / Zephyr / Jira',
        cls: 'item-case',
        run: () => saveCaseCsvFromLastSession(trigger),
      },
    ];
    for (const it of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'save-menu-item ' + it.cls;
      btn.setAttribute('role', 'menuitem');
      const icon = document.createElement('span');
      icon.className = 'i-icon'; icon.textContent = it.icon;
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
    function openMenu() {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      // Listeners attached on next tick so the click that opened the
      // menu doesn't immediately bubble to closeOnOutside.
      setTimeout(() => {
        document.addEventListener('click', closeOnOutside, { capture: true });
        root.addEventListener('keydown', closeOnEsc, { capture: true });
      }, 0);
    }
    function closeMenu() {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
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
  let pendingSave = null;
  let pendingSpec = null;
  let pendingCase = null;

  const saveSkillFromLastSession = async (button) => {
    const steps = lastSessionSlice();
    if (steps.length === 0 || !steps.some((s) => s.kind === 'step')) {
      addMessage({ kind: 'system', text: 'Nothing to save (no tool steps in the last session).' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }

    const result = await hoverPrompt({
      title: 'Save as Skill',
      fields: [
        { id: 'name', label: 'Skill name', placeholder: 'login-as-claude', required: true },
        { id: 'description', label: 'Description', placeholder: 'optional · one line' },
      ],
      confirmLabel: 'Save skill',
    });
    if (!result) return;

    pendingSave = { name: result.name, description: result.description, steps, button };

    button.disabled = true;
    button.textContent = 'Saving…';
    ws.send(JSON.stringify({
      type: 'save-skill',
      payload: { name: pendingSave.name, description: pendingSave.description, steps },
    }));

    setTimeout(() => {
      if (button.textContent === 'Saving…') restoreTrigger(button);
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

  const saveSpecFromLastSession = async (button) => {
    const steps = lastSessionSlice();
    if (steps.length === 0 || !steps.some((s) => s.kind === 'step')) {
      addMessage({ kind: 'system', text: 'Nothing to save (no tool steps in the last session).' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }
    const nAssert = state.assertions.length;
    const result = await hoverPrompt({
      title: 'Save as Playwright spec',
      fields: [
        { id: 'name', label: 'Spec name', placeholder: 'login-flow', required: true },
        { id: 'description', label: 'Description', placeholder: 'optional · one line' },
      ],
      context: nAssert > 0 ? `+ ${nAssert} pending assertion${nAssert === 1 ? '' : 's'} will be baked in` : undefined,
      confirmLabel: 'Save spec',
    });
    if (!result) return;

    pendingSpec = {
      name: result.name,
      description: result.description,
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
      if (button.textContent === 'Saving…') restoreTrigger(button);
    }, 8000);
  };

  const saveCaseCsvFromLastSession = async (button) => {
    const steps = lastSessionSlice();
    if (steps.length === 0 || !steps.some((s) => s.kind === 'step')) {
      addMessage({ kind: 'system', text: 'Nothing to save (no tool steps in the last session).' });
      return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage({ kind: 'system', text: 'Cannot save: service disconnected.' });
      return;
    }
    const nAssert = state.assertions.length;
    const result = await hoverPrompt({
      title: 'Save as Jira test case (Xray CSV)',
      fields: [
        { id: 'name', label: 'Test case name', placeholder: 'login-flow', required: true },
        { id: 'description', label: 'Summary', placeholder: 'optional · used as the test case Summary in Jira' },
        { id: 'jiraProjectKey', label: 'Jira project key', placeholder: 'optional · e.g. PROJ — added as a label' },
        { id: 'labels', label: 'Labels', placeholder: 'optional · space- or comma-separated' },
      ],
      context: nAssert > 0
        ? `+ ${nAssert} pending assertion${nAssert === 1 ? '' : 's'} will become the Expected Result`
        : 'Imports into Xray, Zephyr Scale, or the generic Jira issue importer.',
      confirmLabel: 'Save Jira case',
    });
    if (!result) return;

    pendingCase = {
      name: result.name,
      description: result.description,
      jiraProjectKey: result.jiraProjectKey,
      labels: result.labels,
      steps,
      assertions: state.assertions.slice(),
      button,
    };
    button.disabled = true;
    button.textContent = 'Saving…';
    ws.send(JSON.stringify({
      type: 'save-case-csv',
      payload: {
        name: pendingCase.name,
        description: pendingCase.description,
        jiraProjectKey: pendingCase.jiraProjectKey,
        labels: pendingCase.labels,
        steps,
        assertions: pendingCase.assertions,
      },
    }));

    setTimeout(() => {
      if (button.textContent === 'Saving…') restoreTrigger(button);
    }, 8000);
  };

  const handleCaseCsvExists = async (slug, existingPath) => {
    if (!pendingCase) return;
    const overwrite = await hoverConfirm({
      title: 'Overwrite existing Jira case CSV?',
      body: `A test case CSV named "${slug}" already exists.`,
      context: existingPath,
      confirmLabel: 'Overwrite',
      danger: true,
    });
    if (overwrite) {
      ws.send(JSON.stringify({
        type: 'save-case-csv',
        payload: {
          name: pendingCase.name,
          description: pendingCase.description,
          jiraProjectKey: pendingCase.jiraProjectKey,
          labels: pendingCase.labels,
          steps: pendingCase.steps,
          assertions: pendingCase.assertions,
          overwrite: true,
        },
      }));
      return;
    }
    if (pendingCase.button) restoreTrigger(pendingCase.button);
    addMessage({ kind: 'system', text: `Skipped overwrite of "${slug}".` });
    pendingCase = null;
  };

  const handleSpecExists = async (slug, existingPath) => {
    if (!pendingSpec) return;
    const overwrite = await hoverConfirm({
      title: 'Overwrite existing spec?',
      body: `A Playwright spec named "${slug}" already exists.`,
      context: existingPath,
      confirmLabel: 'Overwrite',
      danger: true,
    });
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
    if (pendingSpec.button) restoreTrigger(pendingSpec.button);
    addMessage({ kind: 'system', text: `Skipped overwrite of "${slug}".` });
    pendingSpec = null;
  };

  const handleSkillExists = async (slug, existingPath) => {
    if (!pendingSave) return;
    const overwrite = await hoverConfirm({
      title: 'Overwrite existing skill?',
      body: `A skill named "${slug}" already exists.`,
      context: existingPath,
      confirmLabel: 'Overwrite',
      danger: true,
    });
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
    if (pendingSave.button) restoreTrigger(pendingSave.button);
    addMessage({ kind: 'system', text: `Skipped overwrite of "${slug}".` });
    pendingSave = null;
  };

  // ───────────────────────── status + new conversation ─────────────────────────

  const setStatus = (text, cls) => {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`;
  };

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
    saveState();
    bodyEl.innerHTML = '';
    lastStepDiv = null;
    updateAssertBadge();
    hideCost();
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

  // ───────────────────────── live cost chip ─────────────────────────
  // Surfaces the running session cost in the header so the user can see
  // money tick up during long runs and decide when to hit Stop. There's no
  // server-side budget cap any more — the cost chip is the user's signal.

  const fmtCost = (n) => '$' + (Number(n) || 0).toFixed(4);
  const showCost = (costUsd, live) => {
    costEl.textContent = fmtCost(costUsd);
    costEl.hidden = false;
    costEl.classList.toggle('live', !!live);
  };
  const hideCost = () => {
    costEl.hidden = true;
    costEl.classList.remove('live');
  };

  const handleServerEvent = (ev) => {
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
        addMessage({ kind: 'system', text: `mcp/${ev.server}: ${ev.status}` });
        return;
      case 'usage':
        showCost(ev.costUsd ?? 0, true);
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
        // Done card carries the final cost; hide the live chip so the
        // header doesn't display stale running data after the run ends.
        hideCost();
        return;
    }
  };

  // ───────────────────────── WebSocket ─────────────────────────

  let ws = null;
  let backoff = 500;
  let running = false;

  const sendLabel = $('.send .send-label');
  const setRunning = (r) => {
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
        root.querySelectorAll('.msg.done .actions .save-trigger').forEach((b) => {
          if (b.textContent === 'Saving…') restoreTrigger(b);
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
        root.querySelectorAll('.msg.done .actions .save-trigger').forEach((b) => {
          if (b.textContent === 'Saving…') restoreTrigger(b);
        });
        // Saved successfully — assertions are now baked into the file, clear them
        state.assertions = [];
        saveState();
        updateAssertBadge();
        pendingSpec = null;
      } else if (msg.type === 'spec-exists') {
        const p = msg.payload ?? {};
        handleSpecExists(p.slug, p.existingPath);
      } else if (msg.type === 'case-csv-saved') {
        const p = msg.payload ?? {};
        addMessage({
          kind: 'system',
          text: `✓ saved Jira test case "${p.name}" → ${p.path}\n  import via Xray Test Case Importer · or Zephyr Scale · or Jira issue importer (CSV).`,
        });
        if (pendingCase?.button) restoreTrigger(pendingCase.button);
        pendingCase = null;
      } else if (msg.type === 'case-csv-exists') {
        const p = msg.payload ?? {};
        handleCaseCsvExists(p.slug, p.existingPath);
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
