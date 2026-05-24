// Nuxt 4 minimal config. The Hover module is registered under `modules`
// (Nuxt's blessed extension point) instead of `vite.plugins` because
// Nuxt's Nitro SSR pipeline bypasses Vite's `transformIndexHtml`.
// See packages/nuxt-integration/README.md for the rationale.
//
// `defineNuxtConfig` is a global injected by Nuxt's IDE setup, but to keep
// the example's tsconfig minimal (no `.nuxt/tsconfig.json` extension) we
// import it explicitly. Nuxt's own type generation re-exports the same
// symbol from `nuxt/config`.
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  devServer: { port: 5179, host: '127.0.0.1' },
  modules: ['@hover-dev/nuxt'],
  hover: {
    autoLaunchChrome: true,
  },
  // Nuxt 4 enables 'compatibilityVersion: 4' by default; pin explicitly so
  // a future major doesn't silently change behaviour under the example.
  future: { compatibilityVersion: 4 },
});
