/**
 * Webpack-compatible source-attribution loader for Next.js (App Router,
 * Turbopack OR `--webpack`). Turbopack accepts webpack-shaped loaders
 * via `turbopack.rules` (see Next 16 docs § Turbopack supported
 * loaders), so the same loader works on both code paths.
 *
 * Only `.jsx` / `.tsx` are routed here — Next doesn't natively handle
 * Vue/Svelte/Astro and a user with those file shapes is on a different
 * track from the App Router story this package supports.
 *
 * Registered by `withHover()` (Turbopack path) at `next.config.*` load
 * time. tsup builds this as a separate entry (`dist/source-loader.js`)
 * so `withHover` can `require.resolve('@hover-dev/next/source-loader')`
 * and pass the absolute path to Turbopack's `rules`.
 */

// Sub-path import (not barrel) so tsup's `noExternal` only inlines the
// JSX transform — not the Vue / Svelte / Astro siblings. Without this
// distinction, Turbopack's import trace would walk into @vue/compiler-sfc
// from inside the loader bundle and choke on Vue's optional-engine
// require() chain (atpl / liquor / twig / …).
import { transformJsx } from '@hover-dev/transform-source/jsx';

interface LoaderContext {
  resourcePath: string;
  rootContext: string;
  async: () => (err: Error | null, code?: string, map?: object) => void;
}

export default function hoverSourceLoader(this: LoaderContext, code: string): void {
  const callback = this.async();
  const filename = this.resourcePath;
  const root = this.rootContext;

  try {
    if (!/\.(jsx|tsx)$/.test(filename)) {
      callback(null, code);
      return;
    }
    const out = transformJsx({ code, filename, root });
    if (out) callback(null, out.code, out.map as unknown as object);
    else callback(null, code);
  } catch (err) {
    // Never block the build. Log and pass the original source through.
    console.warn(
      `[@hover-dev/next] source-attribution skipped ${filename}: ${err instanceof Error ? err.message : String(err)}`,
    );
    callback(null, code);
  }
}
