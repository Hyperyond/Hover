// Next.js's blessed dev-and-runtime init hook. Fires once when a server
// instance is created (`next dev` / `next start`) but NOT during
// `next build` — exactly what we want for the Hover service.
//
// The matching `withHover()` wrapper in `next.config.ts` has already
// stashed the user's options on process.env; registerHover reads them
// back out.
//
// Plugins (e.g. `@hover-dev/security`) are passed as the 2nd argument
// as a list of module specifier strings. The specifiers are resolved
// at runtime inside `register-node.ts` via an opaque dynamic import,
// so plugin packages' Node-only transitive deps never leak into the
// Edge bundle Next compiles from this file. Use the `{ module, options }`
// object form to pass options to a plugin's factory; bare strings call
// the factory with no options.
import { register as registerHover } from '@hover-dev/next/instrumentation';

export async function register() {
  await registerHover({}, [
    // Security mode: HTTPS MITM + flow inspector. Click the ⚡ in the
    // widget header to activate; the secured Chrome opens on CDP port
    // 9333 with its own profile. Remove this entry to disable.
    '@hover-dev/security',
  ]);
}
