/**
 * webpack loader that stamps `data-hover-source` on host elements
 * across React/Vue/Svelte/Astro source files. Registered by HoverPlugin
 * via a `module.rules` injection. Each file extension routes to the
 * matching transform from `@hover-dev/transform-source`.
 *
 * tsup builds this as a separate entry (`dist/loader.js`) so the
 * plugin's `apply()` can `require.resolve('webpack-plugin-hover/loader')`
 * and pass the absolute path to webpack's rule API.
 */

import {
  transformAstro,
  transformJsx,
  transformSvelte,
  transformVue,
} from '@hover-dev/transform-source';

interface LoaderContext {
  resourcePath: string;
  rootContext: string;
  async: () => (err: Error | null, code?: string, map?: object) => void;
}

export default function hoverSourceLoader(this: LoaderContext, code: string): void {
  const callback = this.async();
  const filename = this.resourcePath;
  const root = this.rootContext;
  const input = { code, filename, root };

  void (async () => {
    try {
      let out;
      if (/\.(jsx|tsx)$/.test(filename)) out = transformJsx(input);
      else if (filename.endsWith('.vue')) out = transformVue(input);
      else if (filename.endsWith('.svelte')) out = transformSvelte(input);
      else if (filename.endsWith('.astro')) out = await transformAstro(input);
      else out = null;
      if (out) callback(null, out.code, out.map as unknown as object);
      else callback(null, code);
    } catch (err) {
      // Never block the build — fall through with the original source
      // and log to stderr so a malformed file doesn't break HMR.
      console.warn(
        `[hover:source-attribution] skipped ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
      callback(null, code);
    }
  })();
}
