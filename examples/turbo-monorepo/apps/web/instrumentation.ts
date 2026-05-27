// Next.js's blessed dev-and-runtime init hook. The matching withHover()
// wrapper in next.config.ts has already stashed user options on
// process.env; registerHover reads them back out.
//
// Lives under apps/web/ (NOT the monorepo root) — Next only reads the
// instrumentation.ts of the app it's serving.
//
// Plugins (@hover-dev/security, etc.) go in the second argument as
// module-specifier strings. Top-level imports of plugin packages would
// be statically traced into Next's Edge bundle and break the build;
// register-node.ts resolves the specifier behind an opaque dynamic
// import that the Edge tracer can't follow. In a turbo-monorepo this
// resolver walks up from `process.cwd()` (which is `apps/web/` under
// `pnpm dev`), so a workspace-installed plugin in `apps/web/
// node_modules/@hover-dev/security` is found just like in a flat repo.
import { register as registerHover } from '@hover-dev/next/instrumentation';

export async function register() {
  await registerHover({}, [
    // Security mode: HTTPS MITM + flow inspector. Click the ⚡ in the
    // widget header to activate. Remove this entry to disable.
    '@hover-dev/security',
  ]);
}
