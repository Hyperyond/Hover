import { createRequire } from 'node:module';
import { writeOptionsToEnv, type HoverOptions } from './options.js';

// Built at runtime from two halves so Turbopack's static analyser can't
// fold the call to `createRequire().resolve()` below into a trace edge.
// Without this, Turbopack pulls `dist/source-loader.cjs` into every
// Server Component that imports anything from `@hover-dev/next`, even
// when only `HoverScript` is referenced. The loader is a build-time
// artefact — it must NOT end up in any runtime bundle.
const HOVER_LOADER_SPECIFIER = ['@hover-dev/next', 'source-loader'].join('/');

/**
 * Next.js `next.config.{mjs,ts}` wrapper. Idiomatic shape — matches
 * `withMDX`, `withNextIntl`, `withPlaywright`, etc. across the Next
 * ecosystem.
 *
 * Doesn't start the service. The actual service boot lives in the
 * `instrumentation.ts` `register()` hook (see `./instrumentation`),
 * because Next loads `next.config.*` during `next build` too — booting
 * a service here would leave an orphan on every CI build. `register()`
 * is Next's blessed dev/server-runtime init hook and is correctly
 * skipped at build time.
 *
 * What this function does: serialise the user's HoverOptions onto
 * `process.env`, since `register()` runs in a different Next-managed
 * lifecycle and env vars are the only side-effect-free channel that
 * crosses the boundary. The matching `register()` helper reads them
 * back out via `readOptionsFromEnv()`.
 *
 * TODO (Turbopack vercel/next.js#82945 — `.js`-extension import rewrite):
 *   When that issue lands, we can switch `@hover-dev/core` and
 *   `@hover-dev/widget-bootstrap` back to the workspace's standard
 *   "main: src/*.ts" entry convention (the same shape every other
 *   Hover package uses) and remove the dist-build watcher dance from
 *   `examples/next-app`'s dev flow. Until then those two packages
 *   carry a `dist`-shaped `exports` map AND a `dev: tsc --watch` script
 *   so Next's Turbopack can consume them as plain compiled `.js` files
 *   in monorepo dev.
 *
 * Usage:
 *
 *   // next.config.mjs
 *   import { withHover } from '@hover-dev/next';
 *   export default withHover({ // your existing next config });
 *
 * Or with options:
 *
 *   export default withHover({ // your config }, { autoLaunchChrome: true });
 *
 * Plugins (e.g. `@hover-dev/security`) are NOT configured here — they
 * are passed as the 2nd argument to `register()` in `instrumentation.ts`.
 * Why: plugin packages bring Node-only deps (mockttp, playwright-core, …)
 * that must never end up traced into Next's Edge bundle, and they aren't
 * JSON-serialisable so env-var smuggling doesn't help. The
 * instrumentation hook is already Node-runtime-gated, so that's where
 * plugins belong. See `examples/next-app/instrumentation.ts`.
 */
export function withHover<T extends Record<string, unknown>>(
  nextConfig: T,
  options: HoverOptions = {},
): T {
  writeOptionsToEnv(options);
  return { ...nextConfig, ...injectSourceAttributionRules(nextConfig, options) };
}

/**
 * Inject a Turbopack rule that runs our webpack-compatible source-loader
 * on .jsx/.tsx, stamping `data-hover-source="<file>:<line>:<col>"` so
 * the widget's Fix popover can point the agent at the right file.
 *
 * Why Turbopack rules and not an SWC plugin: Next 16+ Turbopack supports
 * webpack-style loaders via `turbopack.rules`, and our source-attribution
 * logic is the same dispatch as `webpack-plugin-hover/loader` — reusing
 * that loader avoids a 3–5 week detour into Rust + WASM + ABI pinning.
 * The performance cost (~1 ms/file in Node vs near-zero in WASM) is
 * negligible for a one-attribute stamp.
 *
 * No-op outside development (the widget itself is dev-only).
 *
 * .vue / .svelte / .astro are NOT included here on purpose: Next doesn't
 * natively understand those file shapes; a Next user with Vue islands
 * is misconfigured for an entirely separate reason and the widget's
 * other source paths (DOM ancestor chain + React owner names) still
 * give a useful Fix prompt.
 */
function injectSourceAttributionRules<T extends Record<string, unknown>>(
  nextConfig: T,
  options: HoverOptions,
): Partial<T> {
  if (options.sourceAttribution === false) return {};
  if (process.env.NODE_ENV === 'production') return {};

  const loaderPath = resolveLoaderPath();
  if (!loaderPath) {
    // Best-effort: silently skip the rule rather than crash a user's
    // next.config — if our own loader is unresolvable, Hover is broken
    // in lots of other ways already and the user will see those first.
    return {};
  }

  // Don't clobber any rules the user has already declared.
  const existingTurbopack = (nextConfig.turbopack ?? {}) as {
    rules?: Record<string, { loaders?: string[] } | string[]>;
  };
  const existingRules = existingTurbopack.rules ?? {};
  const existingForJsx = existingRules['*.{jsx,tsx}'];
  const userLoaders = Array.isArray(existingForJsx)
    ? existingForJsx
    : existingForJsx?.loaders ?? [];

  return {
    turbopack: {
      ...existingTurbopack,
      rules: {
        ...existingRules,
        '*.{jsx,tsx}': {
          loaders: [loaderPath, ...userLoaders],
        },
      },
    },
  } as unknown as Partial<T>;
}

/** Resolve the absolute on-disk path of our source-loader entry, so
 *  Turbopack can load it. Turbopack's rules accept absolute paths;
 *  bare specifiers resolve from the user project, not from us. */
function resolveLoaderPath(): string | null {
  const req = createRequire(import.meta.url);
  try {
    return req.resolve(HOVER_LOADER_SPECIFIER);
  } catch {
    return null;
  }
}
