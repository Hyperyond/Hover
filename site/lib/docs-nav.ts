/**
 * Docs navigation — the single source of truth for the /docs sidebar and for
 * prev/next ordering. Ported from the old VitePress `sidebar` config, with
 * every link prefixed to its /docs route. Order here is the order shown.
 *
 * Hrefs carry a trailing slash to match `trailingSlash: true` (next.config) —
 * so every emitted <a> and the per-page canonical point straight at the real
 * URL instead of a 308 redirect. Matchers that compare against a slugless
 * pathname normalise the trailing slash themselves (see Sidebar).
 */
export type DocLink = { text: string; href: string };
export type DocSection = { title: string; items: DocLink[] };

export const DOCS_NAV: DocSection[] = [
  {
    title: 'Get started',
    items: [
      { text: 'Introduction', href: '/docs/get-started/' },
      { text: 'Quick start', href: '/docs/get-started/quick-start/' },
      { text: 'Install', href: '/docs/get-started/install/' },
      { text: 'Your first session', href: '/docs/get-started/first-session/' },
      { text: 'Pick an agent', href: '/docs/get-started/agents/' },
      { text: 'Use an API key', href: '/docs/get-started/api-key/' },
    ],
  },
  {
    title: 'Features',
    items: [
      { text: 'Overview', href: '/docs/features/' },
      { text: 'API & security testing', href: '/docs/features/api-test/' },
      { text: 'Save as Spec', href: '/docs/features/save-as-spec/' },
      { text: 'Structured spec output', href: '/docs/features/structured-output/' },
      { text: 'Optimize a spec', href: '/docs/features/optimization-pass/' },
      { text: 'Save as an API-test spec', href: '/docs/features/api-test-spec/' },
      { text: 'Findings cards', href: '/docs/features/findings-cards/' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { text: 'Overview', href: '/docs/reference/' },
      { text: 'Agent registry', href: '/docs/reference/agent-registry/' },
      { text: 'WebSocket protocol', href: '/docs/reference/websocket-protocol/' },
      { text: 'Architecture', href: '/docs/reference/architecture/' },
      { text: 'Roadmap', href: '/docs/reference/roadmap/' },
    ],
  },
  {
    title: 'Development',
    items: [
      { text: 'Overview', href: '/docs/development/' },
      { text: 'Monorepo layout', href: '/docs/development/monorepo-layout/' },
      { text: 'Running examples', href: '/docs/development/running-examples/' },
      { text: 'Smoke tests', href: '/docs/development/smoke-tests/' },
      { text: 'Releasing', href: '/docs/development/releasing/' },
    ],
  },
];

/** Flat, ordered list of every doc page — drives prev/next. */
export const DOCS_FLAT: DocLink[] = DOCS_NAV.flatMap((s) => s.items);

/** Find prev/next neighbours for a given /docs href (trailing-slash form). */
export function neighbours(href: string): { prev?: DocLink; next?: DocLink } {
  const i = DOCS_FLAT.findIndex((l) => l.href === href);
  if (i < 0) return {};
  return { prev: DOCS_FLAT[i - 1], next: DOCS_FLAT[i + 1] };
}
