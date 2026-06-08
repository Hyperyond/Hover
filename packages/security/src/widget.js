// @hover-dev/security widget contribution — registers with the Hover widget
// host when Security mode is engaged. Owns the network panel, the flow row
// rendering, the security:flow:* WS handlers, and the orange theme.
//
// Runs inside the widget's Shadow DOM as a <script type="module"> appended
// after the widget core. Looks up `window.__HOVER_WIDGET__` (set by the
// host in host.js) and registers via host.registerPlugin(...).
//
// Fail-silent contract — every callback runs inside the host's try/catch.
// We additionally clamp the in-memory flow list at FLOWS_CAP so a long
// browsing session can't blow memory.

const FLOWS_CAP = 500;

const host = window.__HOVER_WIDGET__;
if (host) {
  // Helper — format a Date-ish completedAt ms back to a short HH:MM:SS.
  const formatTime = (ms) => {
    if (!ms || typeof ms !== 'number') return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // Format the URL — drop the protocol + host for compactness; keep the
  // path + query because that's the part security testing cares about.
  const formatUrl = (raw) => {
    if (typeof raw !== 'string') return '';
    try {
      const u = new URL(raw);
      return `${u.pathname}${u.search}`;
    } catch {
      return raw;
    }
  };

  // Status code colour bucket.
  const statusClass = (code) => {
    if (typeof code !== 'number') return '';
    if (code >= 500) return 'flow-status-5xx';
    if (code >= 400) return 'flow-status-4xx';
    if (code >= 300) return 'flow-status-3xx';
    if (code >= 200) return 'flow-status-2xx';
    return '';
  };

  // Build one DOM row for a captured Flow. Mirrors the previous in-core
  // renderFlowRow shape: status badge + method chip + URL + meta.
  const renderFlowRow = (flow) => {
    const row = document.createElement('div');
    row.className = 'flow-row';
    if (flow.mutated) row.classList.add('mutated');
    row.dataset.flowId = flow.id;

    const status = document.createElement('span');
    if (flow.response) {
      // Settled — bare status code, coloured by bucket (token-driven).
      status.className = `flow-status ${statusClass(flow.response.statusCode)}`;
      status.textContent = String(flow.response.statusCode);
    } else {
      // In flight — spinning ring instead of a static ellipsis, so it reads
      // as "this request is still going" the same way a running step does.
      status.className = 'flow-status flow-status-pending';
      status.setAttribute('aria-label', 'pending');
    }
    row.appendChild(status);

    const method = document.createElement('span');
    method.className = 'flow-method';
    method.textContent = (flow.request?.method ?? '').toUpperCase();
    row.appendChild(method);

    const url = document.createElement('span');
    url.className = 'flow-url';
    url.textContent = formatUrl(flow.request?.url);
    url.title = flow.request?.url ?? '';
    row.appendChild(url);

    const meta = document.createElement('span');
    meta.className = 'flow-meta';
    const bytes = flow.response?.bodyLen ?? 0;
    const time = formatTime(flow.response?.completedAt ?? flow.request?.startedAt);
    meta.textContent = `${bytes}b · ${time}`;
    row.appendChild(meta);

    return row;
  };

  host.registerPlugin({
    apiVersion: 1,
    name: '@hover-dev/security',
    modeId: 'security',

    // Orange theme. The mode bar uses the same translucent orange gradient
    // as the core widget's `.modebar.engaged` (style.css) rather than a flat
    // brown fill, so it reads with the same glassy depth as the rest of the
    // panel. Everything that isn't orange-by-meaning inherits the core
    // widget's design tokens (--text-mute / --text-dim / --accent / --link /
    // --warn / --error) — they're defined on :host and this CSS is injected
    // into the same shadow root, so the security panel shares one greyscale
    // and one accent system with the main widget instead of a private slate
    // palette. Orange status colours (#fb923c / #fed7aa) are kept verbatim.
    css: `
      .panel { border-color: #fb923c; box-shadow: 0 12px 32px rgba(251, 146, 60, 0.18); }
      .launcher {
        border-color: #fb923c; color: #fb923c;
        box-shadow: 0 4px 18px rgba(251, 146, 60, 0.28), 0 4px 16px rgba(0, 0, 0, 0.4);
      }
      .modebar.engaged {
        background: linear-gradient(180deg, rgba(251, 146, 60, 0.18), rgba(251, 146, 60, 0.08));
        border-bottom-color: rgba(251, 146, 60, 0.55);
        color: #fed7aa;
      }
      .modebar.engaged .modebar-dot {
        background: #fb923c;
        box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.18);
      }

      .plugin-toolbar-btn { position: relative; }
      .plugin-toolbar-badge {
        position: absolute; top: 2px; right: 2px;
        min-width: 14px; height: 14px; padding: 0 3px;
        font-size: 9px; line-height: 14px; text-align: center;
        background: #fb923c; color: var(--bg); border-radius: 7px;
        font-weight: 600;
      }

      .flow-row {
        display: grid;
        grid-template-columns: 36px 50px 1fr auto;
        gap: 8px; align-items: center;
        padding: 4px 10px; border-bottom: 1px solid var(--line);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; color: var(--text-mute);
      }
      .flow-row.mutated { background: rgba(251, 146, 60, 0.08); }
      .flow-status { font-weight: 600; font-variant-numeric: tabular-nums; }
      .flow-status-2xx { color: var(--accent); }
      .flow-status-3xx { color: var(--link); }
      .flow-status-4xx { color: var(--warn); }
      .flow-status-5xx { color: var(--error); }
      /* Pending request — the same open-top rotating ring the core widget
         uses for a running step (style.css .gr-spinner), tinted orange to
         match security mode. Replaces the old static "…". */
      .flow-status-pending {
        display: inline-block; width: 11px; height: 11px;
        border: 1.5px solid #fb923c; border-top-color: transparent;
        border-radius: 50%;
        animation: security-flow-spin 0.9s linear infinite;
        vertical-align: middle;
      }
      @keyframes security-flow-spin { to { transform: rotate(360deg); } }
      .flow-method { color: var(--text-mute); font-weight: 500; }
      .flow-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .flow-meta { color: var(--text-dim); }
      .plugin-overlay-body.security-flows-empty {
        padding: 20px; color: var(--text-dim); font-size: 12px; text-align: center;
      }
    `,

    // No domMutations targeting core widget elements. Default mode is
    // responsible for hiding its own affordances when a plugin mode
    // takes over (Record / Fix / Send / etc. are default-owned and
    // disappear automatically). Plugins should only use domMutations
    // for elements they themselves contributed.

    toolbarButtons: [{
      id: 'network',
      tooltip: 'Captured network flows',
      // Two-arrow SVG (matches the prior hardcoded button's iconography).
      icon: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h10l-2-2"/><path d="M14 11H4l2 2"/></svg>',
      onClick: (api) => api.openOverlay('@hover-dev/security:network'),
      badge: (api) => {
        const flows = api.getState()['@hover-dev/security']?.flows ?? [];
        return flows.length || null;
      },
    }],

    // v0.12 — Save dropdown contribution. Surfaces a "Security spec"
    // entry in the Result card's Save-as menu whenever security mode is
    // active. The service side reads the recorded SecurityCheckStep[]
    // from the control plane closure and writes a `.security.spec.ts`.
    saveEntries: [{
      type: 'save:security:spec',
      label: 'Security spec',
      sub: '__vibe_tests__/<slug>.security.spec.ts · CI regression for recorded checks',
      title: 'Save as Security spec',
      fields: [
        { id: 'name', label: 'Spec name', placeholder: 'orders-idor', required: true },
        { id: 'description', label: 'Description', placeholder: 'optional · what you were probing' },
        { id: 'summary', label: 'Findings', placeholder: 'optional · one-line outcome summary' },
      ],
      confirmLabel: 'Save security spec',
      successMsgTemplate:
        '✓ saved security spec "{name}" → {path}\n  run it: pnpm exec playwright test {path}',
    }],

    overlays: [{
      id: '@hover-dev/security:network',
      title: 'Network',
      actions: [{
        icon: '⌧',
        tooltip: 'Clear flows',
        onClick: (api) => api.setState({ flows: [] }),
      }],
      render: (container, state) => {
        const flows = state.flows ?? [];
        container.innerHTML = '';
        if (flows.length === 0) {
          container.classList.add('security-flows-empty');
          container.textContent = 'No captured flows yet. Browse to your app to start capturing.';
          return;
        }
        container.classList.remove('security-flows-empty');
        for (const flow of flows) {
          container.appendChild(renderFlowRow(flow));
        }
      },
    }],

    onMessage: {
      'security:flow:added': (payload, api) => {
        if (!payload || typeof payload !== 'object') return;
        const flows = api.getState()['@hover-dev/security']?.flows ?? [];
        // Newest-first, FLOWS_CAP ceiling.
        const next = [payload, ...flows].slice(0, FLOWS_CAP);
        api.setState({ flows: next });
      },
      'security:flow:updated': (payload, api) => {
        if (!payload || typeof payload !== 'object' || !payload.id) return;
        const flows = api.getState()['@hover-dev/security']?.flows ?? [];
        const idx = flows.findIndex((f) => f.id === payload.id);
        if (idx < 0) {
          // Update arrived before added (shouldn't normally happen, but be
          // forgiving). Treat as added.
          api.setState({ flows: [payload, ...flows].slice(0, FLOWS_CAP) });
          return;
        }
        const next = [...flows];
        next[idx] = payload;
        api.setState({ flows: next });
      },
      // v0.12 — each recordable replay the agent runs broadcasts a check.
      // The widget tracks the count + the per-check intents so the user
      // sees "agent has recorded 3 security checks" before clicking
      // Save as Security spec. State key is `checks` (a SecurityCheckStep[]).
      'security:check:recorded': (payload, api) => {
        if (!payload || typeof payload !== 'object' || typeof payload.id !== 'number') return;
        const checks = api.getState()['@hover-dev/security']?.checks ?? [];
        api.setState({ checks: [...checks, payload] });
      },
      // The agent ran clear_flows (DELETE /flows) — the service wiped the
      // flow store + recorded checks. Reset our mirrored state so the network
      // panel + the toolbar badge don't go stale.
      'security:flows:cleared': (_payload, api) => {
        api.setState({ flows: [], checks: [] });
      },
    },

    onDeactivate: (api) => {
      // Drop captured flows + checks when leaving security mode so
      // re-entering starts with a clean slate (matches the previous
      // core-side `state.flows = []` on switchMode).
      api.setState({ flows: [], checks: [] });
    },
  });
}
