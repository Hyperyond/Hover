import { execSync } from 'node:child_process';
import { defineConfig } from 'vitepress';

/**
 * Resolve the version label that goes into the top-right nav dropdown.
 *
 * Source priority (first hit wins):
 *   1. `HOVER_DOCS_VERSION` env var — explicit override for one-off builds.
 *   2. Latest annotated git tag — `git describe --tags --abbrev=0`. Works in
 *      Vercel's default full-clone build environment. Strips the leading `v`.
 *   3. `npm view @hover-dev/core version` — registry fallback. Hits network
 *      but build-time only; the resolved string is baked into the static
 *      site, no runtime cost. Useful if the build is run from a shallow
 *      checkout where tags aren't present.
 *   4. The string 'edge' — last-resort sentinel so a build never fails
 *      just because the version couldn't be resolved.
 *
 * Resolution is synchronous + side-effect-free: VitePress evaluates this
 * config once per build, and the resulting string is interpolated into the
 * generated HTML. No runtime fetch.
 */
function resolveVersion(): string {
  if (process.env.HOVER_DOCS_VERSION) return process.env.HOVER_DOCS_VERSION;
  try {
    const tag = execSync('git describe --tags --abbrev=0', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (tag.startsWith('v')) return tag.slice(1);
    if (tag) return tag;
  } catch {
    /* fall through to npm registry */
  }
  try {
    const v = execSync('npm view @hover-dev/core version', {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    })
      .toString()
      .trim();
    if (v) return v;
  } catch {
    /* fall through to sentinel */
  }
  return 'edge';
}

const HOVER_VERSION = resolveVersion();

// VitePress config for Hover's user-facing docs site.
//
// Three-pillar sitemap, matching the home navigation: Get started / Features
// / Reference. Sidebar is scoped per top-level so each pillar's nav reads as
// a clean linear path rather than a dump of every page.
//
// Layout notes:
// - Public assets (banner.png + screenshots/*) already live under
//   docs/assets/ and docs/screenshots/ in the repo and are referenced from
//   the project README. We keep those paths working by adding them as
//   srcExclude entries (so VitePress doesn't try to interpret PNGs as
//   markdown) and by linking with relative paths from each .md page.
//   No copying needed.
// - vite-plugin-hover, the dev-time widget, is a no-op in production, but
//   we don't ship it from this site at all — docs pages are pure markdown.
export default defineConfig({
  title: 'Hover',
  description:
    'AI that hovers over your dev workflow. Natural language frontend testing — speak or type, crystallize into Playwright specs.',
  lang: 'en-US',
  cleanUrls: true,

  // README and CLAUDE.md still live at the repo root; we DO NOT include them
  // as pages here. The docs site is its own narrative. Existing screenshot
  // / banner directories under docs/ remain non-page assets.
  srcExclude: ['**/Harness/**', '**/README.md', '**/CLAUDE.md'],

  // Dev-server URLs (localhost:5173, etc.) appear in code samples and prose
  // because they're the canonical dogfood target. VitePress's link checker
  // would otherwise try to fetch them and fail on the build host.
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#7CFFA8' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Natural-language frontend testing in your dev server. Browser-native voice mode, multi-agent, crystallize to Playwright specs.',
      },
    ],
  ],

  themeConfig: {
    logo: { src: '/favicon.svg', alt: 'Hover' },

    nav: [
      { text: 'Get started', link: '/get-started/' },
      { text: 'Features', link: '/features/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Development', link: '/development/' },
      {
        text: `v${HOVER_VERSION}`,
        items: [
          { text: 'Roadmap', link: '/reference/roadmap' },
          { text: 'Changelog', link: 'https://github.com/Hyperyond/Hover/releases' },
        ],
      },
    ],

    sidebar: {
      '/get-started/': [
        {
          text: 'Get started',
          items: [
            { text: 'Introduction', link: '/get-started/' },
            { text: 'Quick start', link: '/get-started/quick-start' },
            { text: 'Install', link: '/get-started/install' },
            { text: 'Your first session', link: '/get-started/first-session' },
            { text: 'Pick an agent', link: '/get-started/agents' },
          ],
        },
      ],
      '/features/': [
        {
          text: 'Features',
          items: [
            { text: 'Overview', link: '/features/' },
            { text: 'Security testing', link: '/features/security' },
            { text: 'Voice mode', link: '/features/voice-mode' },
            { text: 'Save as Spec', link: '/features/save-as-spec' },
            { text: 'Save as Skill', link: '/features/save-as-skill' },
            { text: 'Save as Jira case', link: '/features/save-as-jira-case' },
            { text: 'Record mode', link: '/features/record-mode' },
            { text: 'Fix prompt', link: '/features/fix-prompt' },
            { text: 'Findings cards', link: '/features/findings-cards' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Overview', link: '/reference/' },
            { text: 'Plugin options', link: '/reference/plugin-options' },
            { text: 'Plugin API', link: '/reference/plugin-api' },
            { text: 'CLI (npx @hover-dev/cli)', link: '/reference/cli' },
            { text: 'Agent registry', link: '/reference/agent-registry' },
            { text: 'WebSocket protocol', link: '/reference/websocket-protocol' },
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Roadmap', link: '/reference/roadmap' },
          ],
        },
      ],
      '/development/': [
        {
          text: 'Development',
          items: [
            { text: 'Overview', link: '/development/' },
            { text: 'Monorepo layout', link: '/development/monorepo-layout' },
            { text: 'Running examples', link: '/development/running-examples' },
            { text: 'Smoke tests', link: '/development/smoke-tests' },
            { text: 'Releasing', link: '/development/releasing' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Hyperyond/Hover' },
    ],

    footer: {
      message: 'Apache 2.0 licensed',
      copyright: 'Copyright © 2026 Hyperyond',
    },

    search: { provider: 'local' },

    outline: { level: [2, 3], label: 'On this page' },

    editLink: {
      pattern: 'https://github.com/Hyperyond/Hover/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
});
