/**
 * Docs navigation — the single source of truth for the /docs sidebar and for
 * prev/next ordering. Ported from the old VitePress `sidebar` config, with
 * every link prefixed to its /docs route. Order here is the order shown.
 */
export type DocLink = { text: string; href: string };
export type DocSection = { title: string; items: DocLink[] };

export const DOCS_NAV: DocSection[] = [
  {
    title: 'Get started',
    items: [
      { text: 'Introduction', href: '/docs/get-started' },
      { text: 'Quick start', href: '/docs/get-started/quick-start' },
      { text: 'Install', href: '/docs/get-started/install' },
      { text: 'Your first session', href: '/docs/get-started/first-session' },
      { text: 'Pick an agent', href: '/docs/get-started/agents' },
    ],
  },
  {
    title: 'Features',
    items: [
      { text: 'Overview', href: '/docs/features' },
      { text: 'Security testing', href: '/docs/features/security' },
      { text: 'Voice mode', href: '/docs/features/voice-mode' },
      { text: 'Save as Spec', href: '/docs/features/save-as-spec' },
      { text: 'Re-record a spec', href: '/docs/features/re-record' },
      { text: 'Save as Skill', href: '/docs/features/save-as-skill' },
      { text: 'Save as Security spec', href: '/docs/features/security-spec' },
      { text: 'Save as Jira case', href: '/docs/features/save-as-jira-case' },
      { text: 'Record mode', href: '/docs/features/record-mode' },
      { text: 'Fix prompt', href: '/docs/features/fix-prompt' },
      { text: 'Findings cards', href: '/docs/features/findings-cards' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { text: 'Overview', href: '/docs/reference' },
      { text: 'Plugin options', href: '/docs/reference/plugin-options' },
      { text: 'Plugin API', href: '/docs/reference/plugin-api' },
      { text: 'CLI (npx @hover-dev/cli)', href: '/docs/reference/cli' },
      { text: 'Agent registry', href: '/docs/reference/agent-registry' },
      { text: 'WebSocket protocol', href: '/docs/reference/websocket-protocol' },
      { text: 'Architecture', href: '/docs/reference/architecture' },
      { text: 'Roadmap', href: '/docs/reference/roadmap' },
    ],
  },
  {
    title: 'Development',
    items: [
      { text: 'Overview', href: '/docs/development' },
      { text: 'Monorepo layout', href: '/docs/development/monorepo-layout' },
      { text: 'Running examples', href: '/docs/development/running-examples' },
      { text: 'Smoke tests', href: '/docs/development/smoke-tests' },
      { text: 'Releasing', href: '/docs/development/releasing' },
    ],
  },
];

/** Flat, ordered list of every doc page — drives prev/next. */
export const DOCS_FLAT: DocLink[] = DOCS_NAV.flatMap((s) => s.items);

/** Find prev/next neighbours for a given /docs href. */
export function neighbours(href: string): { prev?: DocLink; next?: DocLink } {
  const i = DOCS_FLAT.findIndex((l) => l.href === href);
  if (i < 0) return {};
  return { prev: DOCS_FLAT[i - 1], next: DOCS_FLAT[i + 1] };
}
