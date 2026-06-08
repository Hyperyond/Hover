// Widget plugin host — exposes `window.__HOVER_WIDGET__` so plugin widget
// modules (loaded as later <script> blocks in the same widget bundle) can
// register their UI contributions: CSS, DOM mutations, toolbar buttons,
// overlays, WebSocket message handlers, and lifecycle callbacks.
//
// Exclusivity invariant — at most one plugin's contributions are active at
// any time (server-side `currentModeId: string | null` enforces this). When
// the active mode is null, this module no-ops every applier and the widget
// looks identical to a build with no plugins. When a plugin's mode becomes
// active, its CSS, DOM mutations, toolbar buttons, and overlays are
// installed; on deactivate they all tear down cleanly so the next mode
// starts from a clean slate.
//
// Fail-silent — every plugin-supplied callback runs inside a try/catch. A
// plugin crashing in registerPlugin / onMessage / overlay.render /
// onActivate / onDeactivate logs a structured error to console but never
// blocks the WS pump or other plugins.

const HOST_API_VERSION = 1;

/**
 * Initialise the host on a given Shadow DOM root. Returns the host handle
 * also exposed as `window.__HOVER_WIDGET__`. The widget core (client.js)
 * calls this once after attaching the Shadow DOM; plugin modules look up
 * the global and call `registerPlugin()` to contribute.
 *
 * @param {object} ctx - injected by the widget core
 * @param {ShadowRoot} ctx.root - the shadow root the widget renders into
 * @param {Element} ctx.panel - the .panel element where data-plugin-active goes
 * @param {(msg: object) => void} ctx.wsSend - send a message over the live WS
 */
export function initHost(ctx) {
  // Registry of plugins that called registerPlugin() successfully. Each
  // entry tracks both the spec (for activation) and the runtime artefacts
  // (style element, appended toolbar buttons, overlays) so we can tear
  // them down on deactivation.
  /** @type {Map<string, {spec: object, css?: HTMLStyleElement, overlays: Element[], buttons: Element[], mutations: Array<{el: Element, key: string, prev: string | null}>}>} */
  const plugins = new Map();
  /** @type {string | null} */
  let activeModeId = null;
  /** @type {object} */
  const pluginStates = {}; // namespaced by plugin name

  // ─── error reporting helpers ────────────────────────────────────────
  const reportError = (pluginName, where, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // Structured prefix so devtools-filter rules can grep on it.
    console.error(`[hover/plugin "${pluginName}"] ${where} failed: ${msg}`, err);
  };

  // ─── CSS namespacing ────────────────────────────────────────────────
  // Rewrites every selector in the plugin's CSS to be prefixed with
  // `[data-plugin-active="<name>"]`. Naive but adequate for hand-written
  // plugin CSS: splits on top-level commas, prefixes each selector group.
  // Conditional group at-rules (`@media`, `@supports`) are recursed into so
  // the selectors nested under them get namespaced too; other at-rules
  // (`@keyframes`, `@font-face`, `@import`, …) are copied verbatim since
  // their bodies hold keyframe stops / descriptors, not page selectors.
  const namespaceCss = (raw, pluginName) => {
    const attr = `[data-plugin-active="${pluginName}"]`;
    // Strip /* … */ comments first. CSS comments don't nest, so a single
    // non-greedy pass is correct; without this a comment ahead of a rule
    // would be swept into the selector scan and split on its commas, yielding
    // garbage namespaced selectors. (Naive re: comment-like sequences inside
    // strings, but plugin CSS is small and authored, not minified.)
    raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    // Split rules by `}` boundary while keeping the trailing brace; not a
    // full parser, but plugin CSS is small and authored, not minified.
    const out = [];
    let i = 0;
    while (i < raw.length) {
      // Skip whitespace.
      while (i < raw.length && /\s/.test(raw[i])) i++;
      if (i >= raw.length) break;
      // @-rule: capture through to its matching closing brace (or `;` for
      // block-less rules like @import / @charset).
      if (raw[i] === '@') {
        const start = i;
        let depth = 0;
        let started = false;
        let blockStart = -1; // index of the at-rule's first `{`, if any
        while (i < raw.length) {
          if (raw[i] === '{') {
            if (!started) blockStart = i;
            depth++;
            started = true;
          } else if (raw[i] === '}') {
            depth--;
            if (started && depth === 0) {
              i++;
              break;
            }
          } else if (raw[i] === ';' && !started) {
            i++;
            break;
          }
          i++;
        }
        const full = raw.slice(start, i);
        // Conditional group rules wrap ordinary style rules — recurse so the
        // nested selectors get the namespace attr too. Identified by their
        // prelude keyword; everything else (keyframes/font-face/page/…) is
        // copied verbatim.
        const prelude = blockStart >= 0 ? raw.slice(start, blockStart).trim() : full.trim();
        const isGroupRule = /^@(media|supports|container|layer|scope)\b/i.test(prelude);
        if (started && blockStart >= 0 && isGroupRule) {
          // Inner body is everything between the outer `{` and the final `}`.
          const innerBody = raw.slice(blockStart + 1, i - 1);
          out.push(`${prelude} {\n${namespaceCss(innerBody, pluginName)}\n}`);
        } else {
          out.push(full);
        }
        continue;
      }
      // Regular rule: selector list up to `{`, body up to matching `}`.
      const selStart = i;
      while (i < raw.length && raw[i] !== '{') i++;
      if (i >= raw.length) break;
      const selectors = raw.slice(selStart, i).trim();
      i++; // skip {
      const bodyStart = i;
      let depth = 1;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') depth--;
        if (depth > 0) i++;
      }
      const body = raw.slice(bodyStart, i);
      i++; // skip }
      const prefixedSelectors = selectors
        .split(',')
        .map((s) => `${attr} ${s.trim()}`)
        .join(', ');
      out.push(`${prefixedSelectors} {${body}}`);
    }
    return out.join('\n');
  };

  // ─── DOM mutation applier ───────────────────────────────────────────
  //
  // INTENDED USE: mutations the plugin makes to ITS OWN DOM contributions
  // — e.g. toggling a `.collapsed` class on a plugin-owned panel based on
  // user state. The default-mode widget core (Record, Fix, Send, footer,
  // overlays, etc.) is NOT a target for this API — core owns its own
  // visibility and listens for mode changes to hide/show its own widgets.
  //
  // Pointing `hide` or `addClass` at a core selector technically works
  // (the host doesn't enforce ownership), but it creates two-sided
  // coupling: the plugin has to track core's selector names + revert on
  // deactivate, while core could refactor at any time. Avoid.
  //
  // Records original state so deactivate() can revert. Each mutation is
  // (element, key, prev). hide → key='hidden', prev=original `hidden` attr.
  // addClass → key='class:<className>', prev=null|className depending on
  // whether the class was already present.
  const applyDomMutations = (pluginName, entry, mutations) => {
    const root = ctx.root;
    if (mutations.hide && Array.isArray(mutations.hide)) {
      for (const selector of mutations.hide) {
        const el = root.querySelector(selector);
        if (!el) continue;
        const prev = el.hidden ? 'true' : null;
        el.hidden = true;
        entry.mutations.push({ el, key: 'hidden', prev });
      }
    }
    if (mutations.addClass && typeof mutations.addClass === 'object') {
      for (const [selector, className] of Object.entries(mutations.addClass)) {
        const el = root.querySelector(selector);
        if (!el) continue;
        const had = el.classList.contains(className);
        el.classList.add(className);
        entry.mutations.push({
          el,
          key: `class:${className}`,
          prev: had ? 'present' : null,
        });
      }
    }
  };

  const revertDomMutations = (entry) => {
    for (const m of entry.mutations) {
      try {
        if (m.key === 'hidden') {
          m.el.hidden = m.prev === 'true';
        } else if (m.key.startsWith('class:')) {
          const className = m.key.slice('class:'.length);
          if (m.prev === null) m.el.classList.remove(className);
          // else: class was already there before us, leave it
        }
      } catch (err) {
        // Element may have been detached by HMR; ignore.
        void err;
      }
    }
    entry.mutations.length = 0;
  };

  // ─── overlay management ────────────────────────────────────────────
  // Plugin overlays live inside the panel, same position as core overlays.
  // Each plugin overlay is a <div class="overlay plugin-overlay"> with
  // data-overlay-id="<plugin>:<id>". `openOverlay(id)` toggles its `open`
  // class — uses the same CSS the core overlays do for the slide animation.
  const buildOverlayElement = (pluginName, overlay) => {
    const el = document.createElement('div');
    el.className = 'overlay plugin-overlay';
    el.dataset.overlayId = overlay.id;
    el.setAttribute('aria-hidden', 'true');
    // Header: title + optional actions + close button.
    const header = document.createElement('div');
    header.className = 'overlay-header plugin-overlay-header';
    const title = document.createElement('span');
    title.textContent = overlay.title ?? '';
    header.appendChild(title);
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    header.appendChild(spacer);
    if (Array.isArray(overlay.actions)) {
      for (const action of overlay.actions) {
        const btn = document.createElement('button');
        btn.className = 'iconbtn';
        btn.type = 'button';
        if (action.tooltip) {
          btn.setAttribute('data-tooltip', action.tooltip);
          btn.setAttribute('aria-label', action.tooltip);
        }
        btn.textContent = action.icon ?? '';
        btn.addEventListener('click', () => {
          try {
            action.onClick?.(api);
          } catch (err) {
            reportError(pluginName, 'overlay action onClick', err);
          }
        });
        header.appendChild(btn);
      }
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'iconbtn';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.setAttribute('data-tooltip', 'Close');
    closeBtn.textContent = '×';
    // `closeOverlay` lives on the `api` object (defined below in this same
    // closure), not as a free function — call it through `api` or the click
    // throws ReferenceError and the overlay can never be dismissed.
    closeBtn.addEventListener('click', () => api.closeOverlay(overlay.id));
    header.appendChild(closeBtn);
    el.appendChild(header);
    // Body — plugin's render fn populates this on open / state change.
    const body = document.createElement('div');
    body.className = 'overlay-body plugin-overlay-body';
    el.appendChild(body);
    return { root: el, body };
  };

  const reRenderOverlayIfOpen = (pluginName, overlayId) => {
    const entry = plugins.get(pluginName);
    if (!entry) return;
    const overlay = (entry.spec.overlays ?? []).find((o) => o.id === overlayId);
    if (!overlay) return;
    const rec = entry._overlayRecords?.get(overlayId);
    if (!rec || !rec.root.classList.contains('open')) return;
    try {
      overlay.render?.(rec.body, pluginStates[pluginName] ?? {});
    } catch (err) {
      reportError(pluginName, `overlay.render(${overlayId})`, err);
      rec.body.innerHTML = '';
    }
  };

  // ─── toolbar button construction ───────────────────────────────────
  const buildToolbarButton = (pluginName, button) => {
    const el = document.createElement('button');
    el.className = 'iconbtn plugin-toolbar-btn';
    el.type = 'button';
    el.dataset.pluginButtonId = `${pluginName}:${button.id}`;
    if (button.tooltip) {
      el.setAttribute('data-tooltip', button.tooltip);
      el.setAttribute('aria-label', button.tooltip);
      el.setAttribute('data-tooltip-side', 'below');
    }
    if (button.icon) el.innerHTML = button.icon;
    if (button.badge) {
      const badge = document.createElement('span');
      badge.className = 'plugin-toolbar-badge';
      badge.hidden = true;
      el.appendChild(badge);
      // Refresh the badge on state changes via a getter the plugin owns.
      el._refreshBadge = () => {
        try {
          const value = button.badge(api);
          if (value == null || value === '' || value === 0) {
            badge.hidden = true;
          } else {
            badge.hidden = false;
            badge.textContent = String(value);
          }
        } catch (err) {
          reportError(pluginName, `toolbar button "${button.id}" badge`, err);
        }
      };
      el._refreshBadge();
    }
    el.addEventListener('click', () => {
      try {
        button.onClick?.(api);
      } catch (err) {
        reportError(pluginName, `toolbar button "${button.id}" onClick`, err);
      }
    });
    return el;
  };

  // ─── api object (handed to plugin callbacks) ───────────────────────
  const api = {
    apiVersion: HOST_API_VERSION,

    registerPlugin(spec) {
      try {
        if (!spec || typeof spec !== 'object') {
          console.error('[hover/plugin] registerPlugin: spec must be an object');
          return;
        }
        if (typeof spec.name !== 'string' || !spec.name) {
          console.error('[hover/plugin] registerPlugin: spec.name is required');
          return;
        }
        if (spec.apiVersion !== HOST_API_VERSION) {
          console.error(
            `[hover/plugin "${spec.name}"] apiVersion ${String(spec.apiVersion)} ` +
              `incompatible with host ${HOST_API_VERSION} — plugin dropped. ` +
              `Update either the plugin or @hover-dev/core.`,
          );
          return;
        }
        if (plugins.has(spec.name)) {
          console.warn(
            `[hover/plugin "${spec.name}"] already registered; ignoring duplicate registerPlugin call`,
          );
          return;
        }
        plugins.set(spec.name, {
          spec,
          overlays: [],
          buttons: [],
          mutations: [],
          _overlayRecords: new Map(),
        });
        pluginStates[spec.name] = {};
        // If our mode is already active when we register (registration order
        // shouldn't matter), apply now.
        if (activeModeId && spec.modeId === activeModeId) {
          activatePluginUi(spec.name);
        }
      } catch (err) {
        reportError(spec?.name ?? '<unknown>', 'registerPlugin', err);
      }
    },

    getState() {
      // Caller looks up its own state by name. We give back the union for
      // simplicity; plugins are expected to read only their own entries.
      // Future hardening: bind a per-plugin handle that auto-scopes.
      return pluginStates;
    },

    setState(patch) {
      // Determining which plugin is asking by walking the call stack would be
      // too fragile, so we resolve it from the currently-active mode instead:
      // `patch` is the substate to shallow-merge into the active plugin's slot
      //   host.setState({ ...newSubstate })
      // (i.e. it's already scoped to the active plugin — no { [name]: substate }
      // namespacing). Dropped silently when no mode is active.
      if (!patch || typeof patch !== 'object') return;
      if (activeModeId) {
        // Find the plugin owning the active mode and merge into its slot.
        for (const [name, entry] of plugins) {
          if (entry.spec.modeId === activeModeId) {
            pluginStates[name] = { ...pluginStates[name], ...patch };
            // Refresh open overlays + button badges for this plugin.
            for (const overlay of entry.spec.overlays ?? []) {
              reRenderOverlayIfOpen(name, overlay.id);
            }
            for (const btn of entry.buttons) {
              btn._refreshBadge?.();
            }
            return;
          }
        }
      }
      // No active mode — silently drop the patch (mode just deactivated).
    },

    openOverlay(overlayId) {
      // overlayId is the plugin-namespaced id (e.g. "@hover-dev/security:network").
      for (const [name, entry] of plugins) {
        const overlay = (entry.spec.overlays ?? []).find((o) => o.id === overlayId);
        if (!overlay) continue;
        const rec = entry._overlayRecords?.get(overlayId);
        if (!rec) return;
        rec.root.classList.add('open');
        rec.root.setAttribute('aria-hidden', 'false');
        // Initial render.
        try {
          overlay.render?.(rec.body, pluginStates[name] ?? {});
        } catch (err) {
          reportError(name, `overlay.render(${overlayId})`, err);
          rec.body.innerHTML = '';
        }
        return;
      }
    },

    closeOverlay(overlayId) {
      for (const entry of plugins.values()) {
        const rec = entry._overlayRecords?.get(overlayId);
        if (!rec) continue;
        rec.root.classList.remove('open');
        rec.root.setAttribute('aria-hidden', 'true');
        return;
      }
    },

    send(msg) {
      try {
        ctx.wsSend(msg);
      } catch (err) {
        reportError('<host>', 'send', err);
      }
    },
  };

  // ─── activation / deactivation ─────────────────────────────────────
  const activatePluginUi = (pluginName) => {
    const entry = plugins.get(pluginName);
    if (!entry) return;
    const spec = entry.spec;

    // Inject namespaced CSS.
    if (spec.css && typeof spec.css === 'string') {
      try {
        const styleEl = document.createElement('style');
        styleEl.dataset.pluginStyle = pluginName;
        styleEl.textContent = namespaceCss(spec.css, pluginName);
        ctx.root.appendChild(styleEl);
        entry.css = styleEl;
      } catch (err) {
        reportError(pluginName, 'CSS injection', err);
      }
    }

    // Toolbar buttons — appended to header right slot.
    const headerSlot = ctx.root.querySelector('.toolbar') || ctx.root.querySelector('header');
    if (headerSlot && Array.isArray(spec.toolbarButtons)) {
      for (const button of spec.toolbarButtons) {
        try {
          const el = buildToolbarButton(pluginName, button);
          headerSlot.appendChild(el);
          entry.buttons.push(el);
        } catch (err) {
          reportError(pluginName, `toolbarButton "${button?.id}"`, err);
        }
      }
    }

    // Overlays — appended into the panel.
    if (Array.isArray(spec.overlays)) {
      for (const overlay of spec.overlays) {
        try {
          const rec = buildOverlayElement(pluginName, overlay);
          ctx.panel.appendChild(rec.root);
          entry.overlays.push(rec.root);
          entry._overlayRecords.set(overlay.id, rec);
        } catch (err) {
          reportError(pluginName, `overlay "${overlay?.id}"`, err);
        }
      }
    }

    // Declarative DOM mutations.
    if (spec.domMutations && typeof spec.domMutations === 'object') {
      try {
        applyDomMutations(pluginName, entry, spec.domMutations);
      } catch (err) {
        reportError(pluginName, 'domMutations', err);
      }
    }

    // Lifecycle hook.
    if (typeof spec.onActivate === 'function') {
      try {
        spec.onActivate(api);
      } catch (err) {
        reportError(pluginName, 'onActivate', err);
      }
    }
  };

  const deactivatePluginUi = (pluginName) => {
    const entry = plugins.get(pluginName);
    if (!entry) return;
    const spec = entry.spec;

    // onDeactivate first so the plugin can flush state before its DOM
    // disappears.
    if (typeof spec.onDeactivate === 'function') {
      try {
        spec.onDeactivate(api);
      } catch (err) {
        reportError(pluginName, 'onDeactivate', err);
      }
    }

    // Revert DOM mutations.
    revertDomMutations(entry);

    // Remove overlays.
    for (const el of entry.overlays) {
      try {
        el.remove();
      } catch (err) {
        void err;
      }
    }
    entry.overlays.length = 0;
    entry._overlayRecords?.clear();

    // Remove toolbar buttons.
    for (const el of entry.buttons) {
      try {
        el.remove();
      } catch (err) {
        void err;
      }
    }
    entry.buttons.length = 0;

    // Remove style element.
    if (entry.css) {
      try {
        entry.css.remove();
      } catch (err) {
        void err;
      }
      entry.css = undefined;
    }

    // Wipe state (session-scoped by default; persistKey support is a
    // follow-up — see spec).
    pluginStates[pluginName] = {};
  };

  // ─── public surface (used by client.js, not by plugins) ─────────────
  // Called by client.js when a `modes` payload arrives. Synchronises the
  // visible UI with `newModeId`. Idempotent — calling with the same id is
  // a no-op.
  const applyMode = (newModeId) => {
    if (newModeId === activeModeId) return;
    // Deactivate prior mode (if any).
    if (activeModeId) {
      for (const [name, entry] of plugins) {
        if (entry.spec.modeId === activeModeId) {
          deactivatePluginUi(name);
        }
      }
      ctx.panel.removeAttribute('data-plugin-active');
    }
    activeModeId = newModeId;
    // Activate new mode (if any plugin owns it).
    if (newModeId) {
      for (const [name, entry] of plugins) {
        if (entry.spec.modeId === newModeId) {
          ctx.panel.setAttribute('data-plugin-active', name);
          activatePluginUi(name);
        }
      }
    }
  };

  // Called by client.js's WS handler. Returns true if any plugin handled
  // the message; client.js falls back to its built-in handlers otherwise.
  const dispatchMessage = (msg) => {
    if (!msg || typeof msg.type !== 'string') return false;
    let handled = false;
    for (const [name, entry] of plugins) {
      const handler = entry.spec.onMessage?.[msg.type];
      if (!handler) continue;
      // Only route to plugins whose mode is currently active. This matches
      // the spec's exclusivity invariant — inactive plugins don't see
      // events. Future: a plugin could opt into "always-listen" by setting
      // `listenInModes: ['*']` on the manifest, but no use case yet.
      if (entry.spec.modeId && entry.spec.modeId !== activeModeId) continue;
      try {
        handler(msg.payload, api);
        handled = true;
      } catch (err) {
        reportError(name, `onMessage("${msg.type}")`, err);
      }
    }
    return handled;
  };

  // ─── public surface for plugin-contributed Save entries (v0.12) ──
  // Plugin manifests can carry `saveEntries: SaveEntrySpec[]`. Each entry
  // appears in the widget's Save-as dropdown when its mode is active.
  // Unlike toolbarButtons / overlays / domMutations which mount at
  // activate, save entries are *queried* by client.js when the user
  // opens the dropdown — keeps activation light, since the dropdown is
  // built on demand anyway.
  const getActiveSaveEntries = () => {
    if (!activeModeId) return [];
    const out = [];
    for (const [name, entry] of plugins) {
      if (entry.spec.modeId !== activeModeId) continue;
      const list = entry.spec.saveEntries;
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        // Defensive — a plugin returning garbage shouldn't break the
        // dropdown for default mode either.
        if (!e || typeof e !== 'object') continue;
        if (typeof e.type !== 'string' || typeof e.label !== 'string') continue;
        out.push({
          pluginName: name,
          type: e.type,
          label: e.label,
          sub: typeof e.sub === 'string' ? e.sub : '',
          icon: typeof e.icon === 'string' ? e.icon : '',
          // Optional list of `{ id, label, placeholder, required }` for the
          // hoverPrompt modal that captures save metadata before sending.
          fields: Array.isArray(e.fields) ? e.fields : [
            { id: 'name', label: 'Name', placeholder: '', required: true },
          ],
          confirmLabel: typeof e.confirmLabel === 'string' ? e.confirmLabel : 'Save',
          title: typeof e.title === 'string' ? e.title : e.label,
          successMsgTemplate: typeof e.successMsgTemplate === 'string'
            ? e.successMsgTemplate
            : '✓ saved "{name}" → {path}',
        });
      }
    }
    return out;
  };

  const hostExports = { api, applyMode, dispatchMessage, getActiveSaveEntries };
  window.__HOVER_WIDGET__ = api; // plugin-facing surface
  return hostExports;
}
