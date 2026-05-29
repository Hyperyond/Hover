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
    status.className = `flow-status ${statusClass(flow.response?.statusCode)}`;
    status.textContent = flow.response ? String(flow.response.statusCode) : '…';
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

    // Orange theme — same hue values the legacy hardcoded CSS used.
    css: `
      .panel { border-color: #fb923c; box-shadow: 0 12px 32px rgba(251, 146, 60, 0.18); }
      .launcher { border-color: #fb923c; box-shadow: 0 0 18px rgba(251, 146, 60, 0.6); color: #fb923c; }
      .modebar.engaged { background: #2a1810; color: #fed7aa; }
      .modebar.engaged .modebar-dot { background: #fb923c; }

      .plugin-toolbar-btn { position: relative; }
      .plugin-toolbar-badge {
        position: absolute; top: 2px; right: 2px;
        min-width: 14px; height: 14px; padding: 0 3px;
        font-size: 9px; line-height: 14px; text-align: center;
        background: #fb923c; color: #1a0f06; border-radius: 7px;
        font-weight: 600;
      }

      .flow-row {
        display: grid;
        grid-template-columns: 36px 50px 1fr auto;
        gap: 8px; align-items: center;
        padding: 4px 10px; border-bottom: 1px solid rgba(255,255,255,0.04);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; color: #cbd5e1;
      }
      .flow-row.mutated { background: rgba(251, 191, 36, 0.08); }
      .flow-status { font-weight: 600; }
      .flow-status-2xx { color: #34d399; }
      .flow-status-3xx { color: #60a5fa; }
      .flow-status-4xx { color: #fbbf24; }
      .flow-status-5xx { color: #f87171; }
      .flow-method { color: #94a3b8; font-weight: 500; }
      .flow-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .flow-meta { color: #64748b; }
      .plugin-overlay-body.security-flows-empty {
        padding: 20px; color: #64748b; font-size: 12px; text-align: center;
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
    },

    onDeactivate: (api) => {
      // Drop captured flows when leaving security mode so re-entering
      // starts with a clean slate (matches the previous core-side
      // `state.flows = []` on switchMode).
      api.setState({ flows: [] });
    },
  });
}
