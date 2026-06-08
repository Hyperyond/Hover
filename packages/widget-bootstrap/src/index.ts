import { readFileSync } from 'node:fs';
import { readWidget } from './reader.js';
import { jsonStringify, stripModuleExports } from './transforms.js';
import {
  WIDGET_CSS,
  WIDGET_HOST,
  WIDGET_HTML,
  WIDGET_JS,
  WIDGET_REDUCER,
  WIDGET_VOICE,
} from './assets.js';

/**
 * One plugin's widget contribution, as the widget bundle assembler sees it.
 * Server-side plugin manifests carry richer metadata than this; the bundle
 * only needs (a) what to call the plugin, (b) where to read its widget JS,
 * (c) the mode id that gates it. Everything else is conveyed at runtime via
 * WebSocket messages.
 *
 * Mirror of @hover-dev/core's `HoverPluginManifest` projected to the fields
 * the widget assembly needs. Kept as a structural type here so widget-bootstrap
 * doesn't depend on core (one-way: core depends on widget-bootstrap).
 */
export interface WidgetPluginInput {
  /** npm package name, e.g. "@hover-dev/security". Used as the plugin's
   *  identity in registration, namespacing, and error messages. */
  name: string;
  /** Mode id this plugin owns, e.g. "security". May be omitted for plugins
   *  that don't contribute a mode (none today, but the manifest allows it). */
  modeId?: string;
  /** Absolute path to a JS module file. Read once at bundle-assembly time. */
  widgetEntry?: string;
}

export interface WidgetScriptOptions {
  /**
   * Port the widget should WebSocket-connect to. Pass a number for stable
   * cases (most bundlers); pass `() => number` when the actual port isn't
   * known until later — e.g. Vite, where the @hover-dev/core service
   * auto-bumps from 51789 if busy, and the resolved port is only available
   * after `configureServer` finishes. The thunk is invoked at each call
   * so it always sees the latest value.
   */
  port: number | (() => number);

  /**
   * Plugins contributing widget code. Each plugin with `widgetEntry` set
   * has its module read from disk at assembly time and inlined into the
   * bundle after the widget core. Plugins without `widgetEntry` are still
   * advertised to the widget (so the host can show them in the mode bar
   * even if they ship no UI) — they just don't contribute JS.
   *
   * Order in this array determines registration order on the widget side
   * (deterministic for last-wins resolutions in single-mode scenarios).
   */
  plugins?: WidgetPluginInput[];

  /**
   * Optional post-processing pass applied to the concatenated reducer + client
   * body (NOT the preamble, NOT plugin code). The v0.3.x roadmap's "click
   * element → fix prompt" feature uses this for per-host source-attribution
   * injection (React fiber `_debugSource`, framework-agnostic
   * `data-hover-source`). Default: no-op.
   */
  transformBody?: (body: string) => string;
}

/**
 * Vite's `transformIndexHtml` HtmlTagDescriptor shape — the exact thing the
 * Vite plugin returns today. Other bundlers may not consume this shape
 * directly; if so, use `buildWidgetBundle` instead.
 */
export interface WidgetScriptTag {
  tag: 'script';
  attrs: { type: 'module' };
  children: string;
  injectTo: 'body';
}

/**
 * Internal: resolve the port option to a number at call time.
 */
function resolvePort(port: WidgetScriptOptions['port']): number {
  return typeof port === 'function' ? port() : port;
}

/**
 * Build the preamble + body pair without wrapping it in any tag shape.
 *
 * Use this when your host bundler isn't Vite — e.g. webpack's
 * `html-webpack-plugin` (where you append into the head/body via plugin
 * hooks), Next.js `_document.tsx`, Astro `injectScript`, or a raw HTTP
 * server that serves index.html. Assemble your own `<script type="module">`
 * containing `preamble + '\n' + body`.
 *
 * - `preamble` sets the three globals the widget client reads on boot:
 *   `window.__HOVER_PORT__`, `window.__HOVER_CSS__`, `window.__HOVER_HTML__`.
 * - `body` is the reducer + client IIFE concatenation, post-`transformBody`.
 */
export function buildWidgetBundle(opts: WidgetScriptOptions): { preamble: string; body: string } {
  const port = resolvePort(opts.port);

  // Plugin descriptors the widget consults at boot: which plugin names exist,
  // which mode each owns. The widget uses this to know which messages to
  // expect and to render mode-bar entries even before the server's `modes`
  // payload arrives. Plugin code itself is appended at the end of body.
  const pluginInputs = opts.plugins ?? [];
  const pluginDescriptors = pluginInputs.map((p) => ({
    name: p.name,
    modeId: p.modeId ?? null,
    hasWidgetEntry: typeof p.widgetEntry === 'string' && p.widgetEntry.length > 0,
  }));

  // CSS / HTML are stringified (JSON.stringify handles escaping) and stashed
  // on window globals the client IIFE reads on boot.
  const preamble = [
    `window.__HOVER_PORT__ = ${port};`,
    `window.__HOVER_CSS__ = ${readWidget(WIDGET_CSS, jsonStringify)};`,
    `window.__HOVER_HTML__ = ${readWidget(WIDGET_HTML, jsonStringify)};`,
    `window.__HOVER_PLUGINS__ = ${JSON.stringify(pluginDescriptors)};`,
  ].join('\n');

  const reducerInlined = readWidget(WIDGET_REDUCER, stripModuleExports);
  const voiceInlined = readWidget(WIDGET_VOICE, stripModuleExports);
  // Host must precede client.js — client's IIFE calls initHost(...) from
  // its top-level setup. stripModuleExports turns host.js's `export
  // function initHost` into a plain function declaration in the IIFE
  // scope where client.js can call it.
  const hostInlined = readWidget(WIDGET_HOST, stripModuleExports);
  const js = readWidget(WIDGET_JS);

  const coreBody = `${reducerInlined}\n${voiceInlined}\n${hostInlined}\n${js}`;
  const transformedCore = opts.transformBody ? opts.transformBody(coreBody) : coreBody;

  // Each plugin module is inlined inside an IIFE so its top-level
  // declarations don't leak into other plugins' scope. The plugin module
  // looks up `window.__HOVER_WIDGET__` to register itself. Read failure
  // logs a warning and skips that plugin — bundle assembly does not abort.
  const pluginBodies: string[] = [];
  for (const p of pluginInputs) {
    if (!p.widgetEntry) continue;
    let src: string;
    try {
      src = readFileSync(p.widgetEntry, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[hover] failed to read widget entry for plugin "${p.name}" at ${p.widgetEntry}: ${msg}`,
      );
      continue;
    }
    // Wrap in an IIFE so each plugin gets its own scope. If the plugin's
    // module syntax leaks `export` keywords (shouldn't — plugin authors are
    // expected to ship pre-built ESM with exports stripped or use tsup
    // `format: 'iife'`), strip them defensively.
    const stripped = stripModuleExports(src);
    pluginBodies.push(
      `// ─── @hover-dev plugin: ${p.name} ────────────────────────\n` +
        `(function () {\n` +
        `try {\n${stripped}\n} catch (err) {\n` +
        `  console.error('[hover] plugin "${p.name}" widget init failed:', err);\n` +
        `}\n` +
        `})();`,
    );
  }

  const body = pluginBodies.length
    ? `${transformedCore}\n${pluginBodies.join('\n')}`
    : transformedCore;

  return { preamble, body };
}

/**
 * Vite-shaped helper: returns one HtmlTagDescriptor ready to drop into a
 * `transformIndexHtml` return value. Inside Vite this collapses the entire
 * widget injection to a single line.
 */
export function getWidgetScript(opts: WidgetScriptOptions): WidgetScriptTag {
  const { preamble, body } = buildWidgetBundle(opts);
  return {
    tag: 'script',
    attrs: { type: 'module' },
    children: `${preamble}\n${body}`,
    injectTo: 'body',
  };
}

/**
 * Helper: project an array of `HoverPluginManifest` (the core's richer shape)
 * down to `WidgetPluginInput` for the bundle assembler. Consumers that hold
 * manifests directly use this to avoid re-implementing the projection.
 *
 * Kept here rather than in core to preserve the widget-bootstrap → core
 * dependency direction (core depends on widget-bootstrap, not the other way).
 */
export function manifestsToPluginInputs(
  manifests: Array<{ name: string; mode?: { id: string }; widgetEntry?: string }>,
): WidgetPluginInput[] {
  return manifests.map((m) => ({
    name: m.name,
    modeId: m.mode?.id,
    widgetEntry: m.widgetEntry,
  }));
}