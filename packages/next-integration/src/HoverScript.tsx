import type { ReactElement } from 'react';
import { ENV_KEYS } from './options.js';

/**
 * Hover widget injection point for Next.js App Router.
 *
 * Render once in your `app/layout.tsx`, after `{children}` in `<body>`:
 *
 *   import { HoverScript } from '@hover-dev/next';
 *
 *   export default function RootLayout({ children }) {
 *     return (
 *       <html>
 *         <body>
 *           {children}
 *           <HoverScript />
 *         </body>
 *       </html>
 *     );
 *   }
 *
 * No-op in production — the `if (NODE_ENV !== 'development')` early return
 * tree-shakes out of the RSC payload.
 *
 * No 'use client' directive — this is a Server Component. We emit a raw
 * `<script type="module">` containing the inlined widget bundle. The bundle
 * sets up `window.__HOVER_PORT__` from the resolved service port (which the
 * matching `register()` helper publishes to `process.env`) plus
 * `window.__HOVER_CSS__` / `window.__HOVER_HTML__`, then runs the client
 * IIFE — same byte shape as the Vite / Astro / Nuxt / Webpack outputs.
 *
 * Why a Server Component and not `next/script`: `next/script`'s value-add is
 * `strategy`, `onLoad`, `onReady`, `onError`. None apply to a one-shot inline
 * dev-mode bootstrap (and `onLoad` / `onReady` / `onError` explicitly do not
 * work in Server Components per Next's docs). A raw `<script>` rendered into
 * the streamed HTML is the right tool here.
 *
 * Implementation gotchas:
 * - We use `dangerouslySetInnerHTML` because React (server-render) silently
 *   escapes plain text children of `<script>`, which would break the
 *   inlined IIFE. This is the documented React pattern for inline scripts.
 * - We do NOT render a sibling inline `<script>` that sets a window global
 *   on the server, because the resolved port can shift between renders
 *   (auto-bump in the service) and that would cause a hydration mismatch.
 *   The bundle's `preamble` itself sets the globals, in one atomic <script>.
 */
export async function HoverScript(): Promise<ReactElement | null> {
  if (process.env.NODE_ENV !== 'development') return null;

  // The service writes its actual bound port to RESOLVED_PORT after auto-bump.
  // Fall back to PORT (the user-requested port) or 51789 if we beat the
  // service to first render — the widget will reconnect on its own anyway.
  const resolved = process.env[ENV_KEYS.RESOLVED_PORT];
  const requested = process.env[ENV_KEYS.PORT];
  const port = resolved ? Number(resolved) : requested ? Number(requested) : 51789;

  // Dynamic import — keeps `@hover-dev/widget-bootstrap` out of the
  // top-level require() graph in our CJS bundle. Next 15 loads
  // `next.config.ts` through a CJS require step that pulls in
  // `@hover-dev/next` synchronously; widget-bootstrap is ESM-only and
  // would throw ERR_PACKAGE_PATH_NOT_EXPORTED if reachable via require.
  // Async server components are first-class in App Router.
  const { buildWidgetBundle } = await import('@hover-dev/widget-bootstrap');
  const { preamble, body } = buildWidgetBundle({ port });
  const inline = `${preamble}\n${body}`;

  return (
    <script
      type="module"
      data-hover-widget=""
      data-vibe-test="true"
      dangerouslySetInnerHTML={{ __html: inline }}
    />
  );
}
