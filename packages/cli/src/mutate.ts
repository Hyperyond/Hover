import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builders, loadFile, writeFile, type ProxifiedModule } from 'magicast';
import type { Framework, FrameworkId } from './frameworks.js';

/**
 * Result of attempting to wire Hover into the user's config file.
 *
 * - `ok` — config was modified (or was already wired; idempotent).
 * - `manual` — we couldn't safely mutate (no config file, unusual shape).
 *   `instructions` contains the lines the user should paste themselves.
 * - `error` — magicast threw; we bailed without touching the file.
 */
export type MutateResult =
  | { kind: 'ok'; configPath: string; alreadyWired: boolean }
  | { kind: 'manual'; reason: string; instructions: string }
  | { kind: 'error'; reason: string; instructions: string };

/**
 * Wire Hover into the user's config file. Picks the first existing
 * `configCandidates` entry, dispatches to a per-framework mutator. Each
 * mutator is responsible for being idempotent (re-running the CLI on an
 * already-wired project should not duplicate the import or array entry).
 */
export async function mutateConfig(rootDir: string, framework: Framework): Promise<MutateResult> {
  const configPath = framework.configCandidates
    .map(name => join(rootDir, name))
    .find(p => existsSync(p));
  if (!configPath) {
    return {
      kind: 'manual',
      reason: `no ${framework.configCandidates[0]} found`,
      instructions: manualInstructions(framework.id),
    };
  }

  try {
    switch (framework.id) {
      case 'vite':
        return await mutateVite(configPath);
      case 'astro':
        return await mutateAstro(configPath);
      case 'nuxt':
        return await mutateNuxt(configPath);
      case 'next':
        return await mutateNext(configPath, rootDir);
      case 'webpack':
        return await mutateWebpack(configPath);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: 'error',
      reason: msg,
      instructions: manualInstructions(framework.id),
    };
  }
}

// ─── Vite: hover() in plugins array ─────────────────────────────────────

async function mutateVite(configPath: string): Promise<MutateResult> {
  const mod = await loadFile(configPath);
  // Idempotency: bail if `hover` is already imported from vite-plugin-hover.
  // (We could be more clever and re-push if missing-from-array but present
  // in imports, but that's a corner case — overwriting an intentional removal
  // would be more harmful.)
  if (alreadyImported(mod, 'vite-plugin-hover')) {
    return { kind: 'ok', configPath, alreadyWired: true };
  }
  mod.imports.$add({ from: 'vite-plugin-hover', imported: 'hover' });
  const config = unwrapDefineConfig(mod.exports.default);
  ensureArray(config, 'plugins');
  config.plugins.push(builders.functionCall('hover'));
  await writeFile(mod, configPath);
  return { kind: 'ok', configPath, alreadyWired: false };
}

// ─── Astro: hover() in integrations array ───────────────────────────────

async function mutateAstro(configPath: string): Promise<MutateResult> {
  const mod = await loadFile(configPath);
  if (alreadyImported(mod, '@hover-dev/astro')) {
    return { kind: 'ok', configPath, alreadyWired: true };
  }
  mod.imports.$add({ from: '@hover-dev/astro', imported: 'hover' });
  const config = unwrapDefineConfig(mod.exports.default);
  ensureArray(config, 'integrations');
  config.integrations.push(builders.functionCall('hover'));
  await writeFile(mod, configPath);
  return { kind: 'ok', configPath, alreadyWired: false };
}

// ─── Nuxt: '@hover-dev/nuxt' string in modules array ────────────────────

async function mutateNuxt(configPath: string): Promise<MutateResult> {
  const mod = await loadFile(configPath);
  const config = unwrapDefineConfig(mod.exports.default);
  ensureArray(config, 'modules');
  // Idempotency: Nuxt modules are referenced by string, so check the array.
  // magicast arrays are iterable proxies, not real Arrays, so don't trust
  // `Array.isArray` — iterate instead.
  for (const m of config.modules) {
    if (m === '@hover-dev/nuxt') {
      return { kind: 'ok', configPath, alreadyWired: true };
    }
  }
  config.modules.push('@hover-dev/nuxt');
  await writeFile(mod, configPath);
  return { kind: 'ok', configPath, alreadyWired: false };
}

// ─── Next.js: withHover() wrap + instrumentation.ts merge ──────────────

/**
 * Next is the only framework where wiring touches two files:
 *
 * 1. `next.config.{ts,mjs,js}` — wrap the user's exported config in
 *    `withHover(...)`. Idempotent: detect an existing import from
 *    `@hover-dev/next` and bail.
 * 2. `instrumentation.ts` — Next's blessed hook for dev-only server-side
 *    init. We MUST NOT boot the Hover service in `next.config.ts` because
 *    that file is also loaded by `next build`, which would leak an orphan
 *    service into CI. The instrumentation hook only fires for
 *    `next dev` / `next start`.
 *
 * The user's `app/layout.tsx` still needs a `<HoverScript />` import after
 * `{children}` — we can't safely AST-mutate JSX in user code (RSC,
 * Server Component conventions, formatting), so the CLI prints a manual
 * one-liner for that step instead of touching the file.
 */
async function mutateNext(configPath: string, rootDir: string): Promise<MutateResult> {
  const mod = await loadFile(configPath);

  // Step 1: wrap next.config export in withHover(...) — idempotent.
  let configAlreadyWired = false;
  if (alreadyImported(mod, '@hover-dev/next')) {
    configAlreadyWired = true;
  } else {
    mod.imports.$add({ from: '@hover-dev/next', imported: 'withHover' });
    // Wrap whatever the user has as `export default`. Works for plain object,
    // for `defineConfig({...})` (no-op upstream — Next never had that
    // helper), and for already-wrapped configs (which we skip via the
    // `alreadyImported` check above).
    const previous = mod.exports.default;
    mod.exports.default = builders.functionCall('withHover', previous);
    await writeFile(mod, configPath);
  }

  // Step 2: instrumentation.ts — create or merge.
  const instrumentationPath = findOrPickInstrumentationPath(rootDir);
  const instrumentationAlreadyWired = ensureInstrumentationRegistersHover(instrumentationPath);

  const alreadyWired = configAlreadyWired && instrumentationAlreadyWired;
  return { kind: 'ok', configPath, alreadyWired };
}

/**
 * Locate the user's existing instrumentation file, or pick a default path
 * to create one at. Next looks for `instrumentation.{ts,js}` at the project
 * root or under `src/`. We prefer `src/` if it exists (consistent with the
 * Next default scaffold), otherwise drop one at the project root.
 */
function findOrPickInstrumentationPath(rootDir: string): string {
  const candidates = [
    join(rootDir, 'instrumentation.ts'),
    join(rootDir, 'instrumentation.js'),
    join(rootDir, 'src', 'instrumentation.ts'),
    join(rootDir, 'src', 'instrumentation.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  const useSrc = existsSync(join(rootDir, 'src'));
  return useSrc ? join(rootDir, 'src', 'instrumentation.ts') : join(rootDir, 'instrumentation.ts');
}

/**
 * Ensure the instrumentation file calls `register` from
 * `@hover-dev/next/instrumentation`. Returns true if the file already
 * had it wired (so the caller can report "already wired" honestly).
 *
 * We do this as a plain text edit (not magicast) because instrumentation
 * files are usually tiny and the user might have written them in one of
 * many idiomatic shapes (named function, arrow, async). String-level
 * editing keeps formatting stable; magicast's stringifier would reformat.
 */
function ensureInstrumentationRegistersHover(filePath: string): boolean {
  const HOVER_IMPORT = "import { register as registerHover } from '@hover-dev/next/instrumentation';";
  const HOVER_CALL = 'await registerHover();';

  if (!existsSync(filePath)) {
    // Greenfield — write a full instrumentation file.
    const fresh = [
      HOVER_IMPORT,
      '',
      'export async function register() {',
      `  ${HOVER_CALL}`,
      '}',
      '',
    ].join('\n');
    writeFileSync(filePath, fresh, 'utf-8');
    return false;
  }

  const existing = readFileSync(filePath, 'utf-8');
  if (existing.includes('@hover-dev/next/instrumentation')) {
    return true;
  }

  // The file exists but doesn't reference us. We want to (a) add our
  // import at the top, (b) inject `await registerHover();` into the
  // user's existing `register` function if we can find it, or
  // (c) bail to a comment if we can't.
  let next = `${HOVER_IMPORT}\n${existing}`;
  const registerMatch = /(export\s+async\s+function\s+register\s*\([^)]*\)\s*\{)/.exec(next);
  if (registerMatch) {
    next = next.replace(registerMatch[0], `${registerMatch[0]}\n  ${HOVER_CALL}`);
  } else {
    // Couldn't find a function signature to splice into — append a new
    // register export. If the user already has one in a non-standard
    // shape Next will warn at startup, which is fine — better than us
    // silently doing nothing.
    next = `${next}\n\nexport async function register() {\n  ${HOVER_CALL}\n}\n`;
  }
  writeFileSync(filePath, next, 'utf-8');
  return false;
}

// ─── Webpack: new HoverPlugin() in plugins array ────────────────────────

async function mutateWebpack(configPath: string): Promise<MutateResult> {
  const mod = await loadFile(configPath);
  if (alreadyImported(mod, 'webpack-plugin-hover')) {
    return { kind: 'ok', configPath, alreadyWired: true };
  }
  mod.imports.$add({ from: 'webpack-plugin-hover', imported: 'HoverPlugin' });
  const config = unwrapDefineConfig(mod.exports.default);
  ensureArray(config, 'plugins');
  config.plugins.push(builders.newExpression('HoverPlugin'));
  await writeFile(mod, configPath);
  return { kind: 'ok', configPath, alreadyWired: false };
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Check whether a module already has a named/default import from `source`.
 * magicast's `imports` proxy is keyed by binding name; each entry exposes
 * its source as `.from`. Defensive: returns false on any unexpected shape.
 */
function alreadyImported(mod: ProxifiedModule, source: string): boolean {
  try {
    for (const item of mod.imports.$items) {
      if (item.from === source) return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/**
 * `export default defineConfig({ ... })` is the convention across Vite /
 * Astro / Nuxt. Unwrap to the inner object so callers can mutate
 * `plugins` / `integrations` / `modules` directly. Bare object exports
 * (`export default { ... }`) are returned unchanged.
 */
function unwrapDefineConfig(exp: any): any {
  if (exp?.$type === 'function-call' && Array.isArray(exp.$args) && exp.$args[0]) {
    return exp.$args[0];
  }
  return exp;
}

/**
 * Ensure a key on the magicast-proxied config object holds an array. The
 * obvious-looking `cfg[key] ??= []` does NOT work reliably against the
 * proxy — the proxy returns "something" for missing keys (not undefined),
 * so the nullish-assignment short-circuits, and subsequent pushes go into
 * a detached array that never makes it back to the AST. Explicit `if not
 * present then assign a real []` does work, because the proxy turns the
 * assignment into an actual AST node.
 */
function ensureArray(config: any, key: string): void {
  if (config[key] === undefined || config[key] === null) {
    config[key] = [];
  }
}

/**
 * Plain-text fallback instructions for `kind: 'manual'` / `kind: 'error'`.
 * Mirrors what the AST mutator would have produced, so a user with an
 * unusual config file can hand-edit and get the same result.
 */
export function manualInstructions(id: FrameworkId): string {
  switch (id) {
    case 'vite':
      return [
        `Add to your vite config:`,
        ``,
        `  import { hover } from 'vite-plugin-hover';`,
        `  // ...`,
        `  plugins: [react(), hover()],`,
      ].join('\n');
    case 'astro':
      return [
        `Add to your astro config:`,
        ``,
        `  import { hover } from '@hover-dev/astro';`,
        `  // ...`,
        `  integrations: [hover()],`,
      ].join('\n');
    case 'nuxt':
      return [
        `Add to your nuxt config:`,
        ``,
        `  modules: ['@hover-dev/nuxt'],`,
      ].join('\n');
    case 'next':
      return [
        `Three steps for Next.js:`,
        ``,
        `1. Wrap your next.config:`,
        `   import { withHover } from '@hover-dev/next';`,
        `   export default withHover({ /* your config */ });`,
        ``,
        `2. Create instrumentation.ts at your project root:`,
        `   import { register as registerHover } from '@hover-dev/next/instrumentation';`,
        `   export async function register() {`,
        `     await registerHover();`,
        `   }`,
        ``,
        `3. Render <HoverScript /> in your app/layout.tsx, after {children}:`,
        `   import { HoverScript } from '@hover-dev/next';`,
        `   // ... inside <body>: {children}<HoverScript />`,
      ].join('\n');
    case 'webpack':
      return [
        `Add to your webpack config:`,
        ``,
        `  const { HoverPlugin } = require('webpack-plugin-hover');`,
        `  // ...`,
        `  plugins: [..., new HoverPlugin()],`,
      ].join('\n');
  }
}

