import { readWidget } from './reader.js';
import { jsonStringify, stripReducerExports } from './transforms.js';
import {
  WIDGET_CSS,
  WIDGET_HTML,
  WIDGET_JS,
  WIDGET_REDUCER,
} from './assets.js';

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
   * Optional post-processing pass applied to the concatenated reducer + client
   * body (NOT the preamble). The v0.3.x roadmap's "click element → fix prompt"
   * feature will need per-host source-attribution injection here (React fiber
   * `_debugSource`, Vue `data-v-inspector`, framework-agnostic
   * `data-hover-source`). Default: no-op. Bootstrap stays unaware of
   * any framework — the hosting plugin owns the choice.
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

  // CSS / HTML are stringified (JSON.stringify handles escaping) and stashed
  // on window globals the client IIFE reads on boot.
  const preamble = [
    `window.__HOVER_PORT__ = ${port};`,
    `window.__HOVER_CSS__ = ${readWidget(WIDGET_CSS, jsonStringify)};`,
    `window.__HOVER_HTML__ = ${readWidget(WIDGET_HTML, jsonStringify)};`,
  ].join('\n');

  const reducerInlined = readWidget(WIDGET_REDUCER, stripReducerExports);
  const js = readWidget(WIDGET_JS);

  const rawBody = `${reducerInlined}\n${js}`;
  const body = opts.transformBody ? opts.transformBody(rawBody) : rawBody;

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
 * Lowest-level escape hatch: the raw, mtime-cached asset bytes. Useful for
 * future webpack plugins that want to register the widget files as real
 * `Compilation.assets` entries (separate .css / .js URLs the browser fetches
 * with proper caching headers) instead of stuffing everything into one
 * inline `<script>`.
 *
 * Note: `reducer` is the *raw* ESM source (with `export` keywords intact).
 * If you concatenate it into an IIFE you must strip those yourself — or
 * call `buildWidgetBundle` / `getWidgetScript` which do this for you.
 */
export function readWidgetAssets(): { html: string; css: string; js: string; reducer: string } {
  return {
    html: readWidget(WIDGET_HTML),
    css: readWidget(WIDGET_CSS),
    js: readWidget(WIDGET_JS),
    reducer: readWidget(WIDGET_REDUCER),
  };
}
