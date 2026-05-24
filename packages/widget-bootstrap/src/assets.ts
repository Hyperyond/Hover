import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve relative to the compiled file's location so this works in both
// modes — `tsx` running src/ during dev, and `node` running dist/ after
// publish. The widget files live next to the compiled output (the build
// script `cpSync`'s src/widget → dist/widget) so the relative offset is
// the same in both layouts.
const HERE = dirname(fileURLToPath(import.meta.url));
export const WIDGET_DIR = resolve(HERE, 'widget');

export const WIDGET_HTML = resolve(WIDGET_DIR, 'template.html');
export const WIDGET_CSS = resolve(WIDGET_DIR, 'style.css');
export const WIDGET_JS = resolve(WIDGET_DIR, 'client.js');
// Extracted pure-function module (reducer + helpers). Authored as a real
// ES module with `export` so it can be unit-tested from vitest; the export
// keywords are stripped during concatenation into the browser widget IIFE.
export const WIDGET_REDUCER = resolve(WIDGET_DIR, 'reducer.js');
