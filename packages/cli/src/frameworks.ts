/**
 * Registry of frameworks `@hover-dev/cli` knows how to wire Hover into.
 *
 * To add a new framework (e.g. SvelteKit, SolidStart, Qwik, Next-with-Turbopack):
 * write a new entry here and a matching mutator in `mutate.ts`. Nothing else
 * in the CLI changes — `detect.ts`, `install.ts`, and the top-level
 * dispatcher all consume this list generically.
 *
 * `detectDeps` is matched against the user's `package.json` `dependencies` +
 * `devDependencies` keys (and a couple of indirect signals). The order in
 * the array is the priority order — a Nuxt project legitimately has `vite`
 * in its dep tree, so Nuxt must check before Vite. `--<framework>` flags
 * override detection entirely.
 *
 * `configCandidates` is the list of filenames the mutator will look for,
 * in priority order. The first one that exists in cwd wins.
 */
export type FrameworkId = 'astro' | 'nuxt' | 'next' | 'webpack' | 'vite';

export interface Framework {
  /** Short id used as the --<id> CLI flag and the `Detected: <id>` output. */
  id: FrameworkId;
  /** Human-readable name printed in logs. */
  label: string;
  /** Hover package the user gets installed for this framework. */
  hoverPackage: string;
  /** package.json dependency keys whose presence signals this framework.
   *  Checked in priority order across the registry. */
  detectDeps: string[];
  /** Possible filenames for the framework's config file. First match wins. */
  configCandidates: string[];
}

/**
 * Detection priority is high → low. A monorepo or framework whose dep tree
 * legitimately contains a lower-priority framework (Nuxt has `vite`, Astro
 * has `vite`) must come first so the right shim wins.
 *
 * The `Webpack` entry below intentionally checks the user-facing webpack
 * tooling (webpack-cli / next) rather than a transitive `webpack` dep —
 * every Vite project has `webpack` somewhere in its tree because of
 * dev-server internals.
 */
export const FRAMEWORKS: Framework[] = [
  {
    id: 'astro',
    label: 'Astro',
    hoverPackage: '@hover-dev/astro',
    detectDeps: ['astro'],
    configCandidates: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'],
  },
  {
    id: 'nuxt',
    label: 'Nuxt',
    hoverPackage: '@hover-dev/nuxt',
    detectDeps: ['nuxt'],
    configCandidates: ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'],
  },
  {
    id: 'next',
    label: 'Next.js',
    hoverPackage: '@hover-dev/next',
    // Must check before `webpack` — Next 16+ defaults to Turbopack, and a
    // Next project's `next` dep should land on `@hover-dev/next`, not the
    // webpack plugin (which only covers `next dev --webpack`).
    detectDeps: ['next'],
    configCandidates: ['next.config.ts', 'next.config.mjs', 'next.config.js'],
  },
  {
    id: 'webpack',
    label: 'Webpack',
    hoverPackage: 'webpack-plugin-hover',
    // `webpack-cli` is the user-facing wrapper for vanilla webpack-dev-server,
    // Rspack / Rsbuild, CRA, Vue CLI. We no longer detect on `next` here —
    // Next projects route to `@hover-dev/next` above. Pure `webpack` as a
    // transitive dep is too noisy to detect on.
    detectDeps: ['webpack-cli'],
    configCandidates: ['webpack.config.js', 'webpack.config.mjs', 'webpack.config.ts'],
  },
  {
    id: 'vite',
    label: 'Vite',
    hoverPackage: 'vite-plugin-hover',
    // Catch-all for Vite-based projects that aren't Astro / Nuxt / Svelte.
    detectDeps: ['vite'],
    configCandidates: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
  },
];

export function findFrameworkById(id: FrameworkId): Framework | undefined {
  return FRAMEWORKS.find(f => f.id === id);
}
