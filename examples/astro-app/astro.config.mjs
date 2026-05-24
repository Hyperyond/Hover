import { defineConfig } from 'astro/config';
import { hover } from '@hover-dev/astro';

// Astro has its own HTML pipeline that bypasses user Vite plugins'
// `transformIndexHtml` output, so the canonical `vite-plugin-hover` path
// doesn't fully work here (the WS service would boot, but the widget
// script gets dropped). `@hover-dev/astro` wraps the same core service
// + widget bundle behind Astro's integration API. `astro build` /
// `preview` / `sync` are no-op via the integration's `enabled` gate.
export default defineConfig({
  output: 'static',
  server: { port: 5178, host: '127.0.0.1' },
  integrations: [hover({ autoLaunchChrome: true })],
});
