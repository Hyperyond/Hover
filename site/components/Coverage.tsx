/* ── Coverage strip ─────────────────────────────────────────────────────
 * "Works where you already build." A horizontally-scrolling marquee of every
 * stack Hover supports — bundlers + the UI frameworks the source-attribution
 * transforms cover (JSX family via Babel, Vue SFC, Svelte 5, Astro). The list
 * is duplicated once so the CSS marquee loops seamlessly; on touch / narrow
 * screens it's a normal swipeable overflow row, and reduced-motion users get a
 * static wrap (handled in globals.css). */

const STACKS: { name: string; kind: 'bundler' | 'framework' }[] = [
  { name: 'Vite', kind: 'bundler' },
  { name: 'Next.js', kind: 'bundler' },
  { name: 'Nuxt', kind: 'bundler' },
  { name: 'Astro', kind: 'bundler' },
  { name: 'webpack 5', kind: 'bundler' },
  { name: 'Rspack', kind: 'bundler' },
  { name: 'Rsbuild', kind: 'bundler' },
  { name: 'Turbopack', kind: 'bundler' },
  { name: 'React', kind: 'framework' },
  { name: 'Vue', kind: 'framework' },
  { name: 'Svelte 5', kind: 'framework' },
  { name: 'Solid', kind: 'framework' },
  { name: 'Preact', kind: 'framework' },
  { name: 'Astro components', kind: 'framework' },
  { name: 'React Native Web', kind: 'framework' },
];

function Pill({ name, kind }: { name: string; kind: 'bundler' | 'framework' }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-bg px-4 py-2 font-mono text-[13px] text-text-mute"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: kind === 'bundler' ? 'var(--color-mint)' : 'var(--color-link)' }}
      />
      {name}
    </span>
  );
}

export function Coverage() {
  return (
    <section id="coverage" className="relative z-10 mx-auto max-w-6xl px-6 py-12">
      <div className="overflow-hidden rounded-xl border border-line bg-bg-3 py-8">
        <div className="px-8">
          <p className="text-[14px] text-text-mute">
            <span className="text-text">Works where you already build.</span>{' '}
            One <code className="font-mono text-mint">npx @hover-dev/cli setup</code>{' '}
            detects your bundler and wires it up — no config.
          </p>
          <div className="mt-1.5 flex items-center gap-4 font-mono text-[11px] text-text-dim">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-mint" /> bundler
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-link" /> framework
            </span>
          </div>
        </div>

        {/* Marquee: two identical tracks scrolling left; edges faded. */}
        <div className="hover-marquee relative mt-7">
          <div className="hover-marquee-track flex w-max gap-3 px-8">
            {STACKS.map((s) => (
              <Pill key={`a-${s.name}`} {...s} />
            ))}
            {STACKS.map((s) => (
              <Pill key={`b-${s.name}`} {...s} aria-hidden />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
