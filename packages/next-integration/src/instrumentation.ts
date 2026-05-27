import type { HoverOptions } from './options.js';

/**
 * Hover's `instrumentation.ts` register hook.
 *
 * Why instrumentation: Next runs this once when a server instance boots
 * (`next dev` or `next start`), but NOT during `next build`. Booting the
 * service here means we never leak an orphan service into CI builds —
 * which a side effect in `next.config.ts` would, since the config is
 * re-evaluated at build time.
 *
 * Standard wiring in the user's project:
 *
 *   // instrumentation.ts
 *   import { register as registerHover } from '@hover-dev/next/instrumentation';
 *   export async function register() {
 *     await registerHover();
 *   }
 *
 * The CLI's `add` command creates / merges this file via magicast.
 *
 * This file is a deliberately *thin* shell. The real implementation
 * lives in `./register-node.ts` and is reached only via a dynamic
 * `await import(...)` after a `NEXT_RUNTIME === 'nodejs'` guard. Next
 * compiles `instrumentation.js` for both the Node.js and Edge runtimes;
 * by keeping every Node-only symbol (`process.cwd`, `process.once`,
 * `@hover-dev/core`, …) behind that dynamic boundary, the Edge build
 * sees nothing Node-shaped and stays free of "A Node.js API is used"
 * warnings.
 */
// Construct an *opaque* dynamic-import function at module load. Built with
// `new Function` so webpack / Turbopack don't see the literal `import(...)`
// expression inside this file — they can't statically analyse a string
// passed to `Function`, so they neither trace the target into the bundle
// nor replace the dynamic import with a webpack stub that throws
// MODULE_NOT_FOUND at runtime (the failure mode that surfaced in Next 15
// app-router instrumentation when we used a plain `await import(variable)`).
//
// At runtime this returns Node's real ESM dynamic-import, which honours
// the consumer's node_modules and our package's `exports` map — so the
// `@hover-dev/next/internal/register-node` subpath resolves correctly
// even from `.next/server/instrumentation.js` after Next inlines us.
const dynamicImport: (specifier: string) => Promise<unknown> =
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;

export async function register(overrides: HoverOptions = {}): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Package-subpath specifier, not a relative path. Next compiles this
  // file into `.next/server/instrumentation.js`, where any `./` import
  // would resolve relative to `.next/server/` — which doesn't contain
  // our dist files. Package-subpath routes through node_modules + our
  // `exports` map and finds `dist/register-node.{js,cjs}`.
  const mod = (await dynamicImport('@hover-dev/next/internal/register-node')) as
    typeof import('./register-node.js');
  await mod.registerNode(overrides);
}
