import { existsSync } from 'node:fs';
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

