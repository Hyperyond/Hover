// Hover widget — injected by @hover/vite-plugin into the user's dev page.
// Plain JS (no transpilation), self-isolating via Shadow DOM.
// Marked with data-hover="true" so future Playwright runs can skip it.

(() => {
  const HOST_ID = 'hover-widget-host';
  if (document.getElementById(HOST_ID)) return; // HMR re-injection guard

  const PORT = window.__HOVER_PORT__ ?? 51789;
  const WS_URL = `ws://127.0.0.1:${PORT}`;

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
        padding: 12px 16px; border-bottom: 1px solid #eee;
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

      .msg.system { font-size: 11px; color: #9ca3af; font-style: italic; }

      .msg.done {
        background: #f0fdf4; border: 1px solid #bbf7d0;
        border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #166534;
      }
      .msg.done.error { background: #fef2f2; border-color: #fca5a5; color: #991b1b; }
      .msg.done .meta { font-weight: 600; margin-bottom: 4px; }
      .msg.done .summary { color: inherit; opacity: 0.9; white-space: pre-wrap; }

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
    </style>

    <button class="launcher" type="button" aria-label="Open Hover" aria-expanded="false">&#x2728;</button>

    <div class="panel" role="dialog" aria-label="Hover">
      <header>
        <span class="title">Hover</span>
        <span class="status disconnected">connecting…</span>
      </header>
      <div class="body" aria-live="polite"></div>
      <footer>
        <textarea placeholder="e.g. test the login flow" rows="3" disabled aria-label="instruction"></textarea>
        <div class="row">
          <span class="hint">⏎ to send · ⇧⏎ for newline · Esc to close</span>
          <button type="button" class="send" disabled>Send</button>
        </div>
      </footer>
    </div>
  `;

  const $ = (sel) => root.querySelector(sel);
  const launcher = $('.launcher');
  const panel = $('.panel');
  const statusEl = $('.status');
  const bodyEl = $('.body');
  const textarea = $('textarea');
  const sendBtn = $('.send');

  // ───────────────────────── panel open/close ─────────────────────────

  const setOpen = (open) => {
    panel.classList.toggle('open', open);
    launcher.classList.toggle('open', open);
    launcher.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => textarea.focus(), 50);
  };
  const isOpen = () => panel.classList.contains('open');

  launcher.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!isOpen());
  });
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (e.composedPath().includes(host)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  // ───────────────────────── status + rendering ─────────────────────────

  const setStatus = (text, cls) => {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`;
  };

  const scrollToBottom = () => {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };

  const appendMessage = (className, build) => {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    build(div);
    bodyEl.appendChild(div);
    scrollToBottom();
    return div;
  };

  const renderUser = (text) =>
    appendMessage('user', (div) => {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = text;
      div.appendChild(b);
    });

  const renderSystem = (text) =>
    appendMessage('system', (div) => {
      div.textContent = text;
    });

  const renderStep = (ev) =>
    appendMessage('step', (div) => {
      const argStr = JSON.stringify(ev.input ?? {});
      const short = argStr.length > 80 ? argStr.slice(0, 77) + '…' : argStr;
      div.innerHTML = `
        <span class="arrow">→</span>
        <span class="tool"></span>
        <span class="args"></span>
      `;
      div.querySelector('.tool').textContent = ev.tool;
      div.querySelector('.args').textContent = ' ' + short;
    });

  const renderAiText = (text) =>
    appendMessage('ai', (div) => {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = text;
      div.appendChild(b);
    });

  const renderDone = (ev) =>
    appendMessage(ev.isError ? 'done error' : 'done', (div) => {
      const meta = document.createElement('div');
      meta.className = 'meta';
      const turns = ev.turns != null ? `${ev.turns} turn${ev.turns === 1 ? '' : 's'}` : 'done';
      const cost = ev.costUsd != null ? ` · $${ev.costUsd.toFixed(4)}` : '';
      meta.textContent = (ev.isError ? '✗ ' : '✓ ') + turns + cost;
      div.appendChild(meta);
      if (ev.summary) {
        const s = document.createElement('div');
        s.className = 'summary';
        s.textContent = ev.summary;
        div.appendChild(s);
      }
    });

  // mark a previous tool_use as errored when the matching tool_result arrives
  let lastStepDiv = null;
  const renderEvent = (ev) => {
    switch (ev.kind) {
      case 'session_start':
        renderSystem(`session ${ev.sessionId.slice(0, 8)} · ${ev.model ?? '?'}`);
        return;
      case 'mcp_status':
        renderSystem(`mcp/${ev.server}: ${ev.status}`);
        return;
      case 'tool_use':
        lastStepDiv = renderStep(ev);
        return;
      case 'tool_result':
        if (ev.isError && lastStepDiv) lastStepDiv.classList.add('error');
        lastStepDiv = null;
        return;
      case 'text':
        renderAiText(ev.text);
        return;
      case 'session_end':
        renderDone(ev);
        return;
      case 'raw':
        return; // ignore noisy raw passthrough in UI
    }
  };

  // ───────────────────────── WebSocket ─────────────────────────

  let ws = null;
  let backoff = 500;
  let running = false;

  const setRunning = (r) => {
    running = r;
    sendBtn.disabled = r || !ws || ws.readyState !== WebSocket.OPEN;
    textarea.disabled = r || !ws || ws.readyState !== WebSocket.OPEN;
    if (r) setStatus('running', 'running');
    else if (ws && ws.readyState === WebSocket.OPEN) setStatus('connected', 'connected');
  };

  const connect = () => {
    setStatus('connecting…', 'disconnected');
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
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
        renderEvent(msg.payload);
        if (msg.payload.kind === 'session_end') setRunning(false);
      } else if (msg.type === 'error') {
        renderSystem(`error: ${msg.payload?.message ?? 'unknown'}`);
        setRunning(false);
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
    renderUser(text);
    textarea.value = '';
    setRunning(true);
    ws.send(JSON.stringify({ type: 'command', payload: { text } }));
  };

  sendBtn.addEventListener('click', submit);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  connect();
})();
