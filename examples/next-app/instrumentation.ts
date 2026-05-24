// Next.js's blessed dev-and-runtime init hook. Fires once when a server
// instance is created (`next dev` / `next start`) but NOT during
// `next build` — exactly what we want for the Hover service.
//
// The matching `withHover()` wrapper in `next.config.ts` has already
// stashed the user's options on process.env; registerHover reads them
// back out.
import { register as registerHover } from '@hover-dev/next/instrumentation';

export async function register() {
  await registerHover();
}
