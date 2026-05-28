/**
 * Source-attribution transforms for Hover's bundler integrations.
 *
 * Each `transform<Framework>` walks the user's source AST and stamps
 * `data-hover-source="<rel-path>:<line>:<col>"` onto every host element
 * (DOM-tag, not component). The widget's Fix-mode picker reads that
 * attribute at runtime to point the agent at a precise file location.
 *
 * Private workspace package — not published. Each integration shim's
 * tsup build inlines this code into its dist via `noExternal`.
 */

export { SOURCE_ATTR, type AttributionInput, type AttributionResult } from './types.js';
export { transformJsx } from './jsx.js';
export { transformVue } from './vue.js';
