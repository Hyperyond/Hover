// Next.js's blessed dev-and-runtime init hook. The matching withHover()
// wrapper in next.config.ts has already stashed user options on
// process.env; registerHover reads them back out.
//
// Lives under apps/web/ (NOT the monorepo root) — Next only reads the
// instrumentation.ts of the app it's serving.
import { register as registerHover } from '@hover-dev/next/instrumentation';

export async function register() {
  await registerHover();
}
