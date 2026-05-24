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
export async function register(overrides: HoverOptions = {}): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Indirection: a string variable defeats Turbopack's static-import
  // tracer. `await import('./register-node.js')` would be eagerly traced
  // and bundled into BOTH the Node and the Edge runtimes — and the Edge
  // bundle then fails on Node-only transitive deps (`playwright-core`'s
  // CJS require of `chromium-bidi`). With the specifier hidden behind a
  // variable, only the Node runtime resolves it at execution time. (See
  // Next 16's instrumentation tracing behaviour — vercel/next.js does
  // not honour `process.env.NEXT_RUNTIME` checks as compile-time DCE.)
  const specifier = './register-node.js';
  const { registerNode } = (await import(/* @vite-ignore */ specifier)) as typeof import('./register-node.js');
  await registerNode(overrides);
}
