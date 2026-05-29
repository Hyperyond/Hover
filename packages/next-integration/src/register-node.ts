import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENV_KEYS, readOptionsFromEnv, type HoverOptions } from './options.js';
import type { HoverPluginManifest } from '@hover-dev/core/plugin-api';

/**
 * How a user specifies a Hover plugin from `instrumentation.ts`.
 *
 * We accept the module specifier as a *string* (or a `{ module, options }`
 * pair) rather than letting the user write `import securityMode from
 * '@hover-dev/security'` at the top of `instrumentation.ts`. The reason is
 * Edge-runtime isolation: Next compiles `instrumentation.ts` for both
 * runtimes, and a static `import` of `@hover-dev/security` would drag the
 * package's Node-only transitive deps (mockttp / playwright-core / etc.)
 * into the Edge bundle and break the build. Keeping the specifier as a
 * string string defers the resolve to runtime, which only happens on the
 * Node side via this file's opaque dynamic-import helper.
 */
export type PluginSpec =
  | string
  | { module: string; options?: unknown };

/**
 * Node.js-runtime implementation of Hover's instrumentation hook.
 *
 * Everything that touches `process.cwd` / `process.once` / Node-only
 * deps (`@hover-dev/core`, `playwright-core`, `ws`) lives here so the
 * Edge-runtime variant of `instrumentation.js` (compiled by Next from
 * the public `register()` entry) never sees these symbols at all. This
 * is what suppresses the "A Node.js API is used (...) which is not
 * supported in the Edge Runtime" warnings that Next emits when it
 * statically analyses imports — Edge bundling stops at the dynamic
 * `await import('./register-node.js')` boundary.
 */
// Same opaque dynamic-import trick as `instrumentation.ts` uses to reach
// this file. We build the import function with `new Function` so neither
// webpack nor Turbopack can fold the specifier into a static trace — that
// matters here because user-supplied plugin packages (`@hover-dev/security`,
// future third-party plugins) must NOT end up traced into Next's server
// bundle: the agent ecosystem assumes plugins are resolved at runtime from
// the user's `node_modules`, not bundled.
const dynamicImport: (specifier: string) => Promise<unknown> =
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

// Module-scoped guard. Next dev hot-reloads instrumentation when the file
// changes, and the user might also call register() from multiple places.
// `RESOLVED_PORT` on env is the cross-runtime signal HoverScript reads, but
// a module-local boolean is the bulletproof "did this module already do its
// work" check: it survives any env-var clearing edge case, and it's also
// honoured before we'd race two concurrent register() calls (two awaits on
// startService before either sets RESOLVED_PORT).
let didRegister = false;

/** Walk up from `startDir` looking for `node_modules/<moduleId>/package.json`.
 *  This is what Node's resolver does internally — we duplicate it here
 *  because the package-subpath / exports-map dance of standard ESM
 *  resolution refuses to load packages from arbitrary roots, and we
 *  specifically need to root at the user's project (`process.cwd()`),
 *  not at this file's `node_modules/@hover-dev/next/dist/` location.
 *  Returns the absolute package.json path, or throws. */
function findPackageJson(moduleId: string, startDir: string): string {
  let dir = startDir;
  // Safety: bail at filesystem root.
  while (true) {
    const candidate = join(dir, 'node_modules', moduleId, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate "${moduleId}" in any node_modules above ${startDir}`);
}

/** Resolve a bare specifier (e.g. `@hover-dev/security`) to an absolute
 *  ESM entry filesystem path, rooted at the user's project. We can't
 *  just `await import('@hover-dev/security')` because the importer would
 *  be this file's location inside `node_modules/@hover-dev/next/dist/`,
 *  which only finds packages hoisted to our own dep closure. We also
 *  can't use Node's standard resolver on the package directly: plugin
 *  packages like `@hover-dev/security` only declare an `import`
 *  condition in their exports map AND don't expose `./package.json`,
 *  so both `createRequire().resolve('<pkg>')` (no require condition)
 *  and `createRequire().resolve('<pkg>/package.json')` (subpath not in
 *  exports) error out. Walking node_modules manually and parsing the
 *  package.json ourselves sidesteps the conditional-exports machinery
 *  entirely — once we have the package directory and its `exports['.']
 *  .import` / `main` field, the absolute entry path goes through a
 *  plain `file://` dynamic import that the loader accepts unconditionally. */
function resolvePluginEntry(moduleId: string): string {
  const pkgJsonPath = findPackageJson(moduleId, process.cwd());
  const pkgDir = dirname(pkgJsonPath);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    main?: string;
    module?: string;
    exports?: unknown;
  };
  // Prefer exports['.']{ import | default } if present, fall back to
  // legacy `module` / `main`. Plugin packages we care about all set
  // `exports['.']{ import }` to their ESM build.
  const exportsField = pkg.exports as
    | string
    | { import?: string | { default?: string }; default?: string | { default?: string }; [k: string]: unknown }
    | undefined;
  let entry: string | undefined;
  if (typeof exportsField === 'string') {
    entry = exportsField;
  } else if (exportsField && typeof exportsField === 'object') {
    const dot = (exportsField as Record<string, unknown>)['.'] ?? exportsField;
    if (typeof dot === 'string') {
      entry = dot;
    } else if (dot && typeof dot === 'object') {
      const imp = (dot as Record<string, unknown>).import ?? (dot as Record<string, unknown>).default;
      if (typeof imp === 'string') entry = imp;
      else if (imp && typeof imp === 'object') entry = (imp as Record<string, string>).default;
    }
  }
  entry = entry ?? pkg.module ?? pkg.main;
  if (!entry) {
    throw new Error(`package "${moduleId}" has no resolvable ESM entry (no exports, module, or main field)`);
  }
  return resolvePath(pkgDir, entry);
}

async function resolvePlugins(specs: PluginSpec[]): Promise<HoverPluginManifest[]> {
  const manifests: HoverPluginManifest[] = [];
  for (const spec of specs) {
    const moduleId = typeof spec === 'string' ? spec : spec.module;
    const options = typeof spec === 'string' ? undefined : spec.options;
    try {
      const entryPath = resolvePluginEntry(moduleId);
      const mod = (await dynamicImport(pathToFileURL(entryPath).href)) as {
        default?: unknown;
      };
      // Plugin packages expose `defineHoverPlugin(...)`-wrapped default
      // exports: a factory `(opts) => HoverPluginManifest`. Tolerate
      // bare-manifest exports too, in case a plugin doesn't need a factory.
      const factory = mod.default;
      const manifest =
        typeof factory === 'function'
          ? (factory as (o?: unknown) => HoverPluginManifest)(options)
          : (factory as HoverPluginManifest);
      if (!manifest || typeof manifest !== 'object' || !('name' in manifest)) {
        console.warn(
          `[@hover-dev/next] plugin "${moduleId}" did not export a Hover plugin manifest; skipping`,
        );
        continue;
      }
      manifests.push(manifest);
    } catch (err) {
      printPluginLoadError(moduleId, err);
    }
  }
  return manifests;
}

/** Catch known plugin-load failure shapes and print actionable
 *  diagnostics. Targeted at recurrent upstream bugs that surface as
 *  cryptic errors from inside transitive deps. Each branch matches one
 *  specific failure mode and prints a focused fix recipe. */
function printPluginLoadError(moduleId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack ?? '' : '';
  const isErrRequireEsm =
    (err as { code?: string } | null)?.code === 'ERR_REQUIRE_ESM' ||
    message.includes('ERR_REQUIRE_ESM') ||
    /require\(\) of ES Module/i.test(message);
  const mentionsGetPort = /get-port/i.test(message) || /get-port/i.test(stack);
  const mentionsMockttp = /mockttp/i.test(message) || /mockttp/i.test(stack);
  const mentionsPrivateKeyInfo = /Cannot get schema for ['"]PrivateKeyInfo['"]/i.test(message);

  if (isErrRequireEsm && mentionsGetPort && mentionsMockttp) {
    const nodeVersion = process.versions.node;
    const major = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10);
    const minor = Number.parseInt(nodeVersion.split('.')[1] ?? '0', 10);
    const nodeTooOld = major < 22 || (major === 22 && minor < 12);

    console.error(
      `[@hover-dev/next] failed to load plugin "${moduleId}": mockttp + get-port ESM clash`,
    );
    console.error(
      `  Cause: mockttp@4 does \`require('get-port')\` but get-port@7 is ESM-only.`,
    );
    console.error(
      `  Tracked upstream: https://github.com/httptoolkit/mockttp/issues/200`,
    );
    if (nodeTooOld) {
      console.error(
        `  Your Node ${nodeVersion} is too old. Easiest fix: upgrade to Node ≥ 22.12 (sync require(ESM) lands in 22.12).`,
      );
    } else {
      console.error(
        `  Your Node ${nodeVersion} should support sync require(ESM). Try clearing node_modules and reinstalling.`,
      );
    }
    console.error(
      `  Or pin get-port to v6 via project-root overrides:`,
    );
    console.error(
      `    { "pnpm": { "overrides": { "get-port": "^6.1.2" } } }   (or "overrides" for npm, "resolutions" for yarn)`,
    );
    console.error(
      `  Hover will keep running without this plugin. Remove the entry from register() to silence this message.`,
    );
    return;
  }

  console.warn(`[@hover-dev/next] failed to load plugin "${moduleId}": ${message}`);
}

export async function registerNode(
  overrides: HoverOptions = {},
  pluginSpecs: PluginSpec[] = [],
): Promise<void> {
  if (didRegister) return;
  if (process.env[ENV_KEYS.RESOLVED_PORT]) return;
  didRegister = true;

  const fromEnv = readOptionsFromEnv();
  const opts: HoverOptions = { ...fromEnv, ...overrides };

  const enabled = opts.enabled ?? process.env.NODE_ENV === 'development';
  if (!enabled) return;

  const requestedPort = opts.port ?? 51789;
  const chromeDebugPort = opts.chromeDebugPort ?? 9222;
  const autoLaunchChrome = opts.autoLaunchChrome ?? false;
  const agentId = opts.agentId ?? 'claude';
  const model = opts.model ?? 'sonnet';
  const maxBudgetUsd = opts.maxBudgetUsd;

  const { startService } = await import('@hover-dev/core/service');

  const plugins = await resolvePlugins(pluginSpecs);

  let service: Awaited<ReturnType<typeof startService>>;
  try {
    service = await startService({
      port: requestedPort,
      agentId,
      model,
      maxBudgetUsd,
      cdpUrl: `http://localhost:${chromeDebugPort}`,
      devRoot: process.cwd(),
      plugins,
    });
  } catch (err) {
    console.error(
      `[@hover-dev/next] failed to start service: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Publish the resolved port for HoverScript to read at RSC render time.
  process.env[ENV_KEYS.RESOLVED_PORT] = String(service.port);

  // Publish the plugins' widget descriptors so HoverScript can inline each
  // plugin's widget entry alongside the core bundle. Only string fields go
  // across this boundary — no closures / hooks (those stay in-memory in
  // the running service, used by the WS layer).
  const pluginDescriptors = plugins.map((p) => ({
    name: p.name,
    modeId: p.mode?.id,
    widgetEntry: p.widgetEntry,
  }));
  process.env[ENV_KEYS.RESOLVED_PLUGINS] = JSON.stringify(pluginDescriptors);

  const bumped = service.port !== requestedPort;
  const pluginNote = plugins.length
    ? ` · plugins=[${plugins.map((p) => p.name).join(', ')}]`
    : '';
  console.info(
    `[@hover-dev/next] service ready · ws://127.0.0.1:${service.port}${bumped ? ` (auto-bumped from ${requestedPort})` : ''} · agent=${agentId} model=${model}${pluginNote}`,
  );

  // Tear down on process exit. Next manages the dev-server lifecycle and
  // does not expose a public "shutdown" hook to instrumentation, so we
  // hook the Node process directly — same shape as a standalone CLI.
  const shutdown = async (): Promise<void> => {
    try {
      await service.close();
    } catch (err) {
      console.warn(
        `[@hover-dev/next] error closing service: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('beforeExit', shutdown);

  if (!autoLaunchChrome) return;
  const url = opts.devUrl ?? 'http://localhost:3000/';
  const { launchDebugChrome } = await import('@hover-dev/core/launch-chrome');
  launchDebugChrome({ url, port: chromeDebugPort })
    .then(result => {
      if (!result.ok) {
        console.warn(`[@hover-dev/next] couldn't auto-launch Chrome: ${result.reason}`);
      } else if (result.alreadyRunning) {
        console.info(`[@hover-dev/next] reusing existing debug Chrome on :${result.port}`);
      } else {
        console.info(`[@hover-dev/next] debug Chrome launched on :${result.port}`);
      }
    })
    .catch(err => {
      console.warn(
        `[@hover-dev/next] Chrome auto-launch error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
