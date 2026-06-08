import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startService, type ServiceHandle } from '@hover-dev/core/service';
import type { HoverPluginManifest } from '@hover-dev/core/plugin-api';
import { buildWidgetBundle, manifestsToPluginInputs } from '@hover-dev/widget-bootstrap';
import webpack, { type Compiler, type Compilation, type sources as WebpackSources } from 'webpack';

// webpack 5 is a CommonJS package; in ESM contexts (like our tsx/esm
// dev loop, or any user with `"type": "module"`) named imports of the
// runtime values are unreliable. Pull the runtime bits off the default
// import instead — type-only imports above stay as namespaced names.
const { Compilation: CompilationClass, sources: runtimeSources } = webpack;

export interface HoverOptions {
  /** Port for the local Hover WebSocket service (default 51789). Auto-bumps
   *  up to 9 times if busy. */
  port?: number;
  /** Whether the plugin is active. Defaults to
   *  `compiler.options.mode === 'development' && compiler.options.watch`. */
  enabled?: boolean | ((env: { mode: string; watch: boolean }) => boolean);
  /** Chrome CDP debug port the agent will operate on (default 9222). */
  chromeDebugPort?: number;
  /** Auto-launch a debug Chrome pointed at the dev server when webpack
   *  starts. Default false. */
  autoLaunchChrome?: boolean;
  /** Override the URL Chrome opens to. By default we read
   *  `compiler.options.devServer.port` (webpack-dev-server) and assume
   *  `http://localhost:<port>/`. Set this if your dev server lives
   *  elsewhere. */
  devUrl?: string;
  /** Override the project root for saved specs / .hover artifacts. Default is
   *  `compiler.context`. */
  devRoot?: string;
  /** Agent id from @hover-dev/core's registry (default 'claude'). */
  agentId?: string;
  /** Model passed to the agent (default 'sonnet'). */
  model?: string;
  /** Hard $ ceiling per command. No default. */
  maxBudgetUsd?: number;
}

const PLUGIN_NAME = 'HoverPlugin';

/**
 * Webpack 5 plugin that drops the Hover floating-chat widget into the dev
 * server's HTML and starts the local agent-driving WebSocket service.
 *
 * Works in every host that runs the webpack 5 compiler API:
 *
 * - **vanilla `webpack-dev-server`** — the canonical target
 * - **Rspack / Rsbuild** — fully API-compatible, HtmlWebpackPlugin works
 * - **CRA, Vue CLI (legacy)** — both still use webpack 5 + HtmlWebpackPlugin
 *   under the hood; configure via `react-app-rewired` / `craco` for CRA,
 *   or `vue.config.js`'s `configureWebpack` for Vue CLI
 * - **Next.js** — only when started with `next dev --webpack`. Turbopack
 *   (the default since Next 16) does NOT load webpack plugins; a separate
 *   Turbopack-native integration is on the roadmap
 *
 * No-op outside dev mode — guarded by `compiler.options.mode ===
 * 'development' && compiler.options.watch`, which together identify the
 * `webpack serve` lifecycle and exclude both production builds and
 * one-shot dev builds (no point booting a WS service nothing connects to).
 *
 * Composes the same `@hover-dev/widget-bootstrap` middle-layer API as
 * `vite-plugin-hover`, `@hover-dev/astro`, and `@hover-dev/nuxt`, so the
 * widget bytes shipped to the browser are byte-identical.
 */
export class HoverPlugin {
  private readonly options: HoverOptions;
  private readonly plugins: HoverPluginManifest[];
  private servicePromise: Promise<ServiceHandle | null> | null = null;
  private service: ServiceHandle | null = null;

  constructor(options: HoverOptions = {}, ...plugins: HoverPluginManifest[]) {
    this.options = options;
    this.plugins = plugins;
  }

  apply(compiler: Compiler): void {
    const mode = compiler.options.mode ?? 'production';
    // Verified empirically against webpack-dev-server 5: `compiler.options.watch`
    // is still `false` when `apply()` runs under `webpack serve` — wds flips
    // it later. So we can't gate the whole plugin on `watch` here. Instead:
    // gate baseline registration on `mode === 'development'`, then defer the
    // actual service boot to the `watchRun` hook (only fires in watch/serve),
    // so a one-shot `webpack --mode development` build still doesn't spawn an
    // orphan service. The custom `enabled` callback wins if the user provides
    // one; it receives a placeholder `watch: false` because we genuinely
    // don't know yet at apply-time.
    const customEnabled =
      typeof this.options.enabled === 'function'
        ? this.options.enabled({ mode, watch: false })
        : this.options.enabled;
    const enabled = customEnabled ?? mode === 'development';
    if (!enabled) return;
    // Hard floor: regardless of what the custom `enabled` callback returned,
    // never inject the widget into a production build's HTML. The widget
    // expects a running local WS service (boot is deferred to `watchRun`,
    // so prod builds never start one) and shipping a dev-only client to
    // end users is always wrong.
    if (mode !== 'development') return;

    const requestedPort = this.options.port ?? 51789;
    const chromeDebugPort = this.options.chromeDebugPort ?? 9222;
    const agentId = this.options.agentId ?? 'claude';
    const model = this.options.model ?? 'sonnet';
    const devRoot = this.options.devRoot ?? compiler.context;

    // Register the source-attribution loader for React/Vue/Svelte/Astro
    // source files. Resolve the loader path via require.resolve so we
    // pass an absolute path — webpack's loader API runs loaders via
    // Node's resolver and a bare specifier ('webpack-plugin-hover/loader')
    // would resolve from the user's project, not from us.
    const loaderReq = createRequire(import.meta.url);
    let loaderPath: string | null;
    try {
      loaderPath = loaderReq.resolve('webpack-plugin-hover/loader');
    } catch {
      // Monorepo dev path: when consumed via `main: src/index.ts`, the
      // package's own exports map points at .ts files which Node's CJS
      // resolver rejects (no .ts extension). Fall back to a direct path
      // off our own location.
      try {
        loaderPath = loaderReq.resolve('./loader.ts');
      } catch {
        loaderPath = null;
      }
    }
    if (loaderPath) {
      compiler.options.module ??= { rules: [] } as typeof compiler.options.module;
      compiler.options.module.rules ??= [];
      compiler.options.module.rules.unshift({
        test: /\.(jsx|tsx|vue|svelte|astro)$/,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [{ loader: loaderPath }],
      });
    }

    // Boot the service lazily: only when we observe an actual watch-mode
    // run. `webpack --mode development` (one-shot) would otherwise spawn
    // a service nothing connects to. `webpack serve` taps the `watchRun`
    // hook; a true one-shot dev build uses `run`. We start the service
    // exactly once on the first `watchRun`.
    let serviceBooted = false;
    const bootService = (): void => {
      if (serviceBooted) return;
      serviceBooted = true;
      const devServerPort =
        (compiler.options as { devServer?: { port?: number } }).devServer?.port ?? 8080;
      this.servicePromise = startService({
        port: requestedPort,
        agentId,
        model,
        maxBudgetUsd: this.options.maxBudgetUsd,
        cdpUrl: `http://localhost:${chromeDebugPort}`,
        devRoot,
        plugins: this.plugins,
        // Single-Chrome model: service launches the debug Chrome itself.
        autoLaunchChrome: this.options.autoLaunchChrome,
        devUrl: this.options.devUrl ?? `http://localhost:${devServerPort}/`,
      })
        .then(svc => {
          this.service = svc;
          const bumped = svc.port !== requestedPort;
          const pluginNote = this.plugins.length
            ? ` · plugins=[${this.plugins.map((p) => p.name).join(', ')}]`
            : '';
          console.info(
            `[webpack-plugin-hover] service ready · ws://127.0.0.1:${svc.port}${bumped ? ` (auto-bumped from ${requestedPort})` : ''} · agent=${agentId} model=${model}${pluginNote}`,
          );
          return svc;
        })
        .catch(err => {
          console.error(
            `[webpack-plugin-hover] failed to start service: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        });

      // Chrome auto-launch now happens inside startService (single-Chrome
      // model) so the resident security proxy can be baked into it.
    };
    compiler.hooks.watchRun.tap(PLUGIN_NAME, bootService);

    // Lazy-require HtmlWebpackPlugin at compilation time — it's an
    // optional peer dep. Almost every webpack dev pipeline uses it
    // (vanilla wds, CRA, Vue CLI, Rspack, Rsbuild), but we ship a
    // processAssets fallback for the edge case where it's missing.
    //
    // Critical: resolve from the *user's* compiler.context, not from
    // our own package location. Under pnpm the user's html-webpack-plugin
    // and ours are two physically distinct installs (different peer-dep
    // permutations -> different .pnpm/...@<hash>/ folders), and
    // HtmlWebpackPlugin.getHooks() keys its hook table on a per-module
    // WeakMap<Compilation, Hooks>. If we hand it a Compilation that was
    // registered against the user's copy, our copy's WeakMap is empty
    // and getHooks() returns undefined — silently falling through to
    // the processAssets fallback, where the .html asset doesn't yet
    // exist (HtmlWebpackPlugin emits it at a later stage). Net effect:
    // the widget script never lands in the HTML and the user sees a
    // dev server that boots cleanly but has no Hover UI.
    const req = createRequire(join(compiler.context, '_'));
    let HtmlWebpackPlugin: { getHooks?: (c: Compilation) => HtmlPluginHooks | undefined } | undefined;
    try {
      HtmlWebpackPlugin = req('html-webpack-plugin');
    } catch {
      HtmlWebpackPlugin = undefined;
    }

    compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation: Compilation) => {
      const hooks = HtmlWebpackPlugin?.getHooks?.(compilation);
      if (hooks?.alterAssetTagGroups) {
        // Canonical path: HtmlWebpackPlugin gives us a typed tag-tree.
        hooks.alterAssetTagGroups.tapPromise(PLUGIN_NAME, async data => {
          const tag = await this.buildScriptTag();
          if (tag) data.bodyTags.push(tag);
          return data;
        });
        return;
      }
      // Fallback: mutate any emitted .html asset's source by string-splicing
      // before </body>. Less precise than the HtmlWebpackPlugin path
      // (no attribute escaping, no head/body bucketing), but it's a last
      // resort for unusual setups.
      compilation.hooks.processAssets.tapPromise(
        {
          name: PLUGIN_NAME,
          stage: CompilationClass.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        async assets => {
          const tag = await this.buildScriptTag();
          if (!tag) return;
          const inline = `<script type="module">${tag.innerHTML}</script>`;
          for (const [name, source] of Object.entries(assets)) {
            if (!name.endsWith('.html')) continue;
            const original = (source as WebpackSources.Source).source().toString();
            const idx = original.lastIndexOf('</body>');
            const next =
              idx === -1
                ? `${original}\n${inline}\n`
                : `${original.slice(0, idx)}${inline}\n${original.slice(idx)}`;
            compilation.updateAsset(name, new runtimeSources.RawSource(next));
          }
        },
      );
    });

    // Tear down the service on dev-server shutdown. `watchClose` fires on
    // Ctrl-C; `shutdown` is the newer (webpack 5.94+) catch-all that also
    // covers `compiler.close()`. Tapping both is safe — close() is
    // idempotent via the `this.service` guard.
    const tearDown = async (): Promise<void> => {
      // A fast Ctrl-C can race service boot: `bootService` sets
      // `this.servicePromise` immediately but only assigns `this.service`
      // inside the resolved `.then()`. Await the promise so a shutdown that
      // arrives mid-boot still closes the resolved handle instead of leaking it.
      const svc = this.service ?? (await this.servicePromise);
      if (!svc) return;
      try {
        await svc.close();
      } catch (err) {
        console.warn(
          `[webpack-plugin-hover] error closing service: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.service = null;
    };
    compiler.hooks.watchClose.tap(PLUGIN_NAME, () => {
      void tearDown();
    });
    // `shutdown` was added in webpack 5.94; older versions don't have it.
    // The optional-chain-via-undefined-check keeps us compatible.
    if ((compiler.hooks as { shutdown?: unknown }).shutdown) {
      (compiler.hooks as { shutdown: { tapPromise: (n: string, fn: () => Promise<void>) => void } })
        .shutdown.tapPromise(PLUGIN_NAME, tearDown);
    }
  }

  /**
   * Resolve the service promise and produce a script-tag descriptor for
   * HtmlWebpackPlugin's `bodyTags` array. Returns `null` if the service
   * failed to start — we don't inject a broken widget.
   */
  private async buildScriptTag(): Promise<HtmlPluginAssetTag | null> {
    const svc = await this.servicePromise;
    if (!svc) return null;
    const { preamble, body } = buildWidgetBundle({
      port: svc.port,
      plugins: manifestsToPluginInputs(this.plugins),
    });
    return {
      tagName: 'script',
      voidTag: false,
      meta: { plugin: PLUGIN_NAME },
      attributes: { type: 'module' },
      innerHTML: `${preamble}\n${body}`,
    };
  }
}

export default HoverPlugin;

// Factory alias for symmetry with the other Hover integrations
// (`hover()` is the verb the other packages export). `new HoverPlugin()`
// is still the canonical form for webpack users.
export function hover(
  options: HoverOptions = {},
  ...plugins: HoverPluginManifest[]
): HoverPlugin {
  return new HoverPlugin(options, ...plugins);
}

// ─── Internal types ─────────────────────────────────────────────────────

interface HtmlPluginAssetTag {
  tagName: string;
  voidTag: boolean;
  meta?: Record<string, unknown>;
  attributes: Record<string, string | boolean | undefined>;
  innerHTML?: string;
}

interface HtmlPluginAssetTagGroupsData {
  headTags: HtmlPluginAssetTag[];
  bodyTags: HtmlPluginAssetTag[];
}

interface HtmlPluginHooks {
  alterAssetTagGroups: {
    tapPromise: (
      name: string,
      callback: (data: HtmlPluginAssetTagGroupsData) => Promise<HtmlPluginAssetTagGroupsData>,
    ) => void;
  };
}
