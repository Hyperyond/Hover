import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Sparkle } from '@/components/Sparkle';
import { WidgetDemo } from '@/components/WidgetDemo';
import { TerminalDemo } from '@/components/TerminalDemo';
import { CopyCommand } from '@/components/CopyCommand';
import { Waitlist } from '@/components/Waitlist';
import { Nav } from '@/components/Nav';
import { VideoSection } from '@/components/VideoSection';
import { Coverage } from '@/components/Coverage';
import { Comparison } from '@/components/Comparison';
import { Pricing } from '@/components/Pricing';
import { Faq } from '@/components/Faq';

/* Server-side file probe: only feed the <video> a src once the export actually
 * exists under public/, so the page never offers a play button that 404s. Drop
 * public/demo.mp4 (+ optional public/demo-poster.png) and it switches on. */
const PUBLIC = join(process.cwd(), 'public');
const DEMO_MP4 = existsSync(join(PUBLIC, 'demo.mp4')) ? '/demo.mp4' : '';
const DEMO_POSTER = existsSync(join(PUBLIC, 'demo-poster.png')) ? '/demo-poster.png' : '';

const GITHUB = 'https://github.com/Hyperyond/Hover';
const DOCS = '/docs/';

/** SoftwareApplication structured data — helps search + LLM engines describe
 *  Hover accurately (open-source DeveloperApplication, free, Playwright-based). */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Hover',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web (Chrome via CDP)',
  description:
    'Open-source tool that lets AI drive your real browser from a chat widget to author end-to-end tests, then crystallises the session into a plain @playwright/test spec that runs in CI with no AI and no API key.',
  url: 'https://gethover.dev',
  downloadUrl: 'https://www.npmjs.com/package/@hover-dev/cli',
  license: 'https://github.com/Hyperyond/Hover/blob/main/LICENSE',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Organization', name: 'Hyperyond', url: 'https://github.com/Hyperyond' },
  sameAs: ['https://github.com/Hyperyond/Hover', 'https://www.npmjs.com/package/@hover-dev/cli'],
};

export default function Home() {
  return (
    <div className="relative overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <Backdrop />
      <Nav />
      <Hero />
      <Triad />
      {/* Walkthrough video. Self-hosted MP4 is preferred — YouTube flagged the
       * source clip (ASWFWUyMUlc) with a server-side "confirm you're not a bot"
       * gate that no embed param can bypass. Drop the export at public/demo.mp4
       * (and optionally a still at public/demo-poster.png) and it plays for
       * everyone, ad-block and all. Until the file exists this shows a
       * placeholder; the id is kept only as a documented fallback. */}
      <VideoSection src={DEMO_MP4} poster={DEMO_POSTER} />
      <Coverage />
      <Pillars />
      <Outputs />
      <Security />
      <Comparison />
      <Roadmap />
      <Pricing />
      <Waitlist />
      <Faq />
      <CTA />
      <Footer />
    </div>
  );
}

/* ── Atmospheric backdrop ───────────────────────────────────────────────
 * A faint mint radial bloom behind the hero + a hairline grid, so the page
 * has depth instead of a flat near-black fill. Pointer-events none. */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background:
          'radial-gradient(60% 50% at 50% -10%, rgba(124,255,168,0.10), transparent 70%)',
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage:
            'radial-gradient(80% 60% at 50% 0%, #000 30%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(80% 60% at 50% 0%, #000 30%, transparent 80%)',
        }}
      />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-12 md:pt-16">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_minmax(380px,420px)] lg:gap-10">
        {/* Left — copy */}
        <div className="min-w-0">
          <a
            href={GITHUB}
            className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-bg-2 px-3.5 py-1.5 text-[12px] text-text-mute transition-colors hover:border-[rgba(124,255,168,0.4)] hover:text-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            v0.15 · latest release
          </a>

          <h1 className="font-mono text-[38px] font-semibold leading-[1.08] tracking-tight md:text-[52px]">
            AI authors the test.
            <br />
            <span className="text-mint">CI runs plain Playwright.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-text-mute md:text-[18px]">
            Describe a flow in plain English; AI drives your{' '}
            <em className="not-italic text-text">real</em> Chrome once to
            explore it. When the run&rsquo;s clean, Hover crystallises it into a
            standard{' '}
            <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[14px] text-mint">
              @playwright/test
            </code>{' '}
            spec that runs in CI with zero AI, forever.
          </p>

          <div id="install" className="mt-9 flex flex-wrap items-center gap-3">
            <CopyCommand />
            <a
              href={DOCS}
              className="rounded-md border border-line px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
            >
              Read the docs →
            </a>
          </div>

          <p className="mt-5 text-[13px] text-text-dim">
            No per-token resale — Hover spawns the{' '}
            <span className="text-text-mute">claude</span> /{' '}
            <span className="text-text-mute">codex</span> CLI already on your{' '}
            <code className="font-mono text-text-mute">PATH</code>, on your
            subscription or your own API key.
          </p>

          <p className="mt-3 text-[13px] text-text-dim">
            Not a flat dump — page objects, <span className="text-text-mute">test.step</span>{' '}
            stages, a community seed library, and an optional AI polish pass you
            accept via diff.{' '}
            <a
              href="#roadmap"
              className="text-text underline-offset-2 hover:underline"
            >
              See what shipped
            </a>
            .
          </p>
        </div>

        {/* Right — live widget replica */}
        <div className="flex min-w-0 justify-center lg:justify-end">
          <WidgetDemo />
        </div>
      </div>

      <TerminalDemo />
    </section>
  );
}

/* TerminalDemo (the You-type / generated-spec panel) now lives in
 * components/TerminalDemo.tsx — a client component that typewriter-reveals the
 * real generated spec. */

/* ── The triad: one widget, three AI jobs ───────────────────────────────
 * The page's organizing thesis. The three things the agent does for you —
 * author, optimize, secure — over ONE widget, with the crystallize moat as the
 * shared through-line: whatever the AI does, the artifact that lands in your
 * repo is plain @playwright/test that runs in CI with no AI. The "secure" card
 * is orange to match the @hover-dev/security plugin's mode. (A red "pentest"
 * card joins once @hover-dev/pentest ships to npm.) */
const TRIAD = [
  {
    k: 'author',
    tag: 'Author',
    accent: '#7CFFA8',
    title: 'Describe a flow → a spec',
    body: 'Type "log in, add a todo, check it persists" in plain English. AI drives your real Chrome once to work it out, then crystallizes the clean run into a standard @playwright/test file with semantic getByRole / getByLabel selectors.',
  },
  {
    k: 'optimize',
    tag: 'Optimize',
    accent: '#7CFFA8',
    title: 'Polish the specs you already have',
    body: 'Point Hover at an existing spec and the AI proposes a cleaner version — page objects, named test.step stages, observed assertions — which you accept via a diff. The deterministic original is always kept; the pass is off by default.',
  },
  {
    k: 'secure',
    tag: 'Secure',
    accent: '#fb923c',
    title: 'Flip the same widget to a security mode',
    body: 'Add a plugin and the panel grows two security modes: orange replays captured API calls with mutations to probe IDOR / authz and crystallizes findings into .security.spec.ts CI gates; red goes offensive — SQLi / XSS / SSTI / SSRF on your own dev app — and writes a findings report.',
  },
];

function Triad() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-8 pt-4 md:pt-8">
      <SectionLabel>One widget, three jobs</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[26px] font-semibold leading-tight tracking-tight md:text-[34px]">
        AI <span className="text-mint">authors</span>,{' '}
        <span className="text-mint">optimizes</span>, and{' '}
        <span style={{ color: '#fb923c' }}>secures</span> your tests — then CI
        runs plain Playwright.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        One floating widget in your dev page, with modes that grow as you need
        them. The through-line never changes: whatever the AI does, the artifact
        that checks into git is plain{' '}
        <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-mint">
          @playwright/test
        </code>{' '}
        that runs in CI with no agent, no model, no key.
      </p>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {TRIAD.map((t) => (
          <article
            key={t.k}
            className="rounded-lg border border-line bg-bg-2 p-6 transition-colors hover:border-line-2"
          >
            <div
              className="mb-4 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: t.accent }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.accent }} />
              {t.tag}
            </div>
            <h3 className="text-[17px] font-semibold tracking-tight text-text">
              {t.title}
            </h3>
            <p className="mt-3 text-[14px] leading-relaxed text-text-mute">
              {t.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Four core pillars ──────────────────────────────────────────────── */
const PILLARS = [
  {
    k: 'explore',
    title: 'Explore once → deterministic spec',
    body: 'AI drives the browser to figure out the flow. What lands in your repo is plain @playwright/test code with semantic getByRole / getByLabel selectors — the agent\'s job ends at "save".',
  },
  {
    k: 'runtime',
    title: 'Zero AI at runtime, zero tokens in CI',
    body: 'Other AI-testing tools keep a model in the loop when the test runs — every PR, every nightly pays for LLM calls. Hover spends the model once, at authoring time. Green builds never pay a recurring tax.',
  },
  {
    k: 'byo',
    title: 'BYO-CLI — your subscription or your API key',
    body: 'Hover bundles no AI runtime. It spawns whatever coding-agent CLI is on your PATH — claude, codex, cursor-agent, aider — on the Pro / Max / ChatGPT plan you already pay for, or your own model API key dropped into the widget (kept in your browser, injected into the CLI env, never uploaded).',
  },
  {
    k: 'coverage',
    title: 'Five bundlers, two artifacts',
    body: 'Vite, Astro, Nuxt, Next.js (Turbopack), webpack 5 — plus React Native Web. Every verified session crystallises two ways: a Playwright spec for CI and a Jira-importable test case.',
  },
];

function Pillars() {
  return (
    <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Why Hover</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        Optimised for one axis nobody else picks:{' '}
        <span className="text-mint">artifact portability</span>.
      </h2>
      <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
        {PILLARS.map((p, i) => (
          <article
            key={p.k}
            className="group bg-bg p-8 transition-colors hover:bg-bg-2"
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg-3 font-mono text-[12px] text-mint">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="h-px flex-1 bg-line transition-colors group-hover:bg-[rgba(124,255,168,0.3)]" />
            </div>
            <h3 className="text-[18px] font-semibold tracking-tight text-text">
              {p.title}
            </h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-text-mute">
              {p.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Three outputs table ────────────────────────────────────────────── */
const OUTPUTS = [
  {
    file: '.spec.ts',
    name: 'Playwright spec',
    reader: 'Node + Playwright (CI)',
    audience: 'CI · devs writing code',
    accent: 'text-mint',
  },
  {
    file: '.case.csv',
    name: 'Jira test case',
    reader: 'Xray · Zephyr · Jira',
    audience: 'QA reviewing · PM tracking',
    accent: 'text-warn',
  },
];

function Outputs() {
  return (
    <section id="outputs" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>One exploration, two audiences</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        A single <span className="text-mint">Save as ▾</span> menu, two files
        that check into git.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Nothing lives in a vendor database. A spec written on a laptop on Monday
        is reviewed by QA on Tuesday and runs in CI from Wednesday — same file,
        no export step.
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {OUTPUTS.map((o) => (
          <article
            key={o.file}
            className="rounded-lg border border-line bg-bg-2 p-6 transition-colors hover:border-line-2"
          >
            <code
              className={`font-mono text-[13px] ${o.accent}`}
            >{`<slug>${o.file}`}</code>
            <h3 className="mt-3 text-[17px] font-semibold tracking-tight">
              {o.name}
            </h3>
            <dl className="mt-5 space-y-3 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-text-dim">Read by</dt>
                <dd className="text-right text-text-mute">{o.reader}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-text-dim">Audience</dt>
                <dd className="text-right text-text-mute">{o.audience}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Security testing — two modes ────────────────────────────────────────
 * The same widget grows two distinct security modes, each its own plugin +
 * colour: orange (@hover-dev/security — business/authz, crystallizes to a CI
 * spec) and red (@hover-dev/pentest — offensive vuln scan, writes a findings
 * report). Themed so they read as separate modes, not the mint default flow. */
const SECURITY_MODES = [
  {
    k: 'security',
    accent: '#fb923c',
    glow: 'rgba(251,146,60',
    plugin: '@hover-dev/security',
    heading: 'orange — security',
    pitch:
      'Business / authorization testing. A local HTTPS MITM lets the agent replay captured API calls with mutations to probe access control; confirmed findings crystallize into .security.spec.ts regression gates that run in CI — no proxy, no agent.',
    output: '.security.spec.ts',
    checksTitle: 'Probes for',
    checks: [
      'IDOR — replay a URL with another user’s id',
      'Auth bypass — drop or swap the auth header',
      'Parameter tampering — user_id / role / price / isAdmin',
      'Missing headers — CSP / HSTS / SameSite',
      'PII leakage — user data in query strings',
    ],
  },
  {
    k: 'pentest',
    accent: '#dc2626',
    glow: 'rgba(220,38,38',
    plugin: '@hover-dev/pentest',
    heading: 'red — pentest',
    pitch:
      'Offensive vulnerability hunting on your own dev app. The agent operates the app to generate traffic, then attacks the captured flows — destructive on, confirmed in-band — and writes a findings report with severity, PoC, and an explicit “not tested” section. Origin-locked; authorized own-app testing only.',
    output: 'findings report',
    checksTitle: 'Attacks for',
    checks: [
      'Injection — SQLi / XSS / SSTI, confirmed in-band',
      'SSRF — internal / metadata fetch via a url param',
      'Open redirect & path traversal — param tampering',
      'GraphQL — introspection left enabled',
      'IDOR / mass-assignment / auth-bypass — replayed',
    ],
  },
];

function Security() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Two security modes</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        The same widget, an{' '}
        <span style={{ color: '#fb923c' }}>orange</span> and a{' '}
        <span style={{ color: '#dc2626' }}>red</span> security mode.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Add a plugin and the panel grows a security mode — one for the
        defensive, business-logic side and one for the offensive. Zero external
        deps (no mitmproxy, no Python, no system CA); both run on your own dev
        server, authorized testing only.
      </p>
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {SECURITY_MODES.map((m) => (
          <div
            key={m.k}
            className="relative overflow-hidden rounded-xl border bg-bg-2 p-8"
            style={{ borderColor: `${m.glow},0.3)` }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(60% 80% at 80% 0%, ${m.glow},0.10), transparent 70%)` }}
            />
            <div className="relative">
              <div
                className="mb-4 flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em]"
                style={{ color: m.accent }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.accent }} />
                {m.heading}
              </div>
              <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px]" style={{ color: m.accent }}>
                {m.plugin}
              </code>
              <p className="mt-4 text-[14.5px] leading-relaxed text-text-mute">{m.pitch}</p>
              <p className="mt-3 text-[13px] text-text-dim">
                → crystallizes to{' '}
                <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[12px] text-text">{m.output}</code>
              </p>
              <div className="mt-6 rounded-lg border border-line bg-bg-3 p-5">
                <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-text-dim">
                  {m.checksTitle}
                </div>
                <ul className="space-y-2.5">
                  {m.checks.map((c) => (
                    <li key={c} className="flex items-start gap-3 text-[13px] leading-snug text-text-mute">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: m.accent }} />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── Structured output — shipped + what's next ──────────────────────────
 * The structured spec-output suite (page objects, test.step, popup pairing, a
 * conventions file, a community seed library, the optional AI optimization
 * pass) has landed on `main`. Chrome extension + Hover Cloud remain planned.
 * Each card carries a `status` so shipped vs planned renders distinctly. */
const ROADMAP = [
  {
    status: 'shipped',
    title: 'Page objects from repeated flows',
    body: 'When a login or setup flow recurs across saved specs, Hover lifts it into a shared Page Object plus a fixture, so the selectors live in one file instead of five.',
  },
  {
    status: 'shipped',
    title: 'Structured test.step reports',
    body: 'Saved flows wrap their actions in named test.step(...) stages, so the Playwright HTML report reads as logical steps instead of a flat action list.',
  },
  {
    status: 'shipped',
    title: 'Multi-tab & popup flows',
    body: 'A click that opens a payment popup or OAuth tab crystallises with the Promise.all listener pairing Playwright needs, so the saved spec drives the new tab without a race.',
  },
  {
    status: 'shipped',
    title: 'Project conventions file',
    body: 'A .hover/conventions.md in your repo (which flows matter, where login lives, your preferred selectors) feeds the agent at exploration time, so generated specs follow your house style.',
  },
  {
    status: 'shipped',
    title: 'Community translation seeds',
    body: 'The optimization pass learns from a library of worked examples — built-in for common patterns like downloads, and extensible: you or the community add a seed in .hover/rules/ to teach a new pattern, no fork, no plugin code.',
  },
  {
    status: 'shipped',
    title: 'Optional AI optimization pass',
    body: 'AI reads a generated spec and proposes a polished version you accept via a diff — observed assertions added, buggy behaviour flagged // KNOWN BUG. The deterministic original is always kept and the pass is off by default.',
  },
  {
    status: 'planned',
    title: 'Chrome extension',
    body: 'Drop the bundler-plugin dependency so Hover can drive any tab — staging URLs, third-party sites, multi-origin flows. Likely a separate repo; loses source attribution, gains universal page coverage.',
  },
  {
    status: 'planned',
    title: 'Hover Cloud',
    body: 'A hosted layer over the specs you author locally: intent-driven self-heal, test-rot detection, AI failure diagnosis. Authoring stays local and free; CI still runs plain Playwright.',
  },
];

function Roadmap() {
  return (
    <section id="roadmap" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Structured output</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        Hover grows the output into a{' '}
        <span className="text-mint">maintainable suite</span>.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Hover saves a clean, portable spec, then grows it into an architecture:
        page objects and fixtures lifted from flows repeated across specs, named
        test.step stages, popup / new-tab pairing, a community-extensible seed
        library, and an optional AI pass that polishes a spec while always
        keeping the deterministic original. All shipped, all still plain
        Playwright with no agent in CI. Next: a Chrome extension and Hover
        Cloud. Follow along on{' '}
        <a href={GITHUB} className="text-text underline-offset-2 hover:underline">
          GitHub
        </a>
        .
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {ROADMAP.map((r) => {
          const shipped = r.status === 'shipped';
          return (
            <article
              key={r.title}
              className={
                shipped
                  ? 'rounded-lg border border-[rgba(124,255,168,0.35)] bg-[rgba(124,255,168,0.04)] p-7'
                  : 'rounded-lg border border-dashed border-line bg-bg-2 p-7'
              }
            >
              <span
                className={
                  shipped
                    ? 'mb-4 inline-flex items-center gap-1.5 rounded-full border border-[rgba(124,255,168,0.35)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-mint'
                    : 'mb-4 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim'
                }
              >
                <span className={shipped ? 'text-mint' : 'h-1.5 w-1.5 rounded-full bg-text-dim'}>
                  {shipped ? '✓' : ''}
                </span>
                {shipped ? 'Shipped' : 'Planned'}
              </span>
              <h3 className="text-[17px] font-semibold tracking-tight text-text">{r.title}</h3>
              <p className="mt-3 text-[14px] leading-relaxed text-text-mute">{r.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-28">
      <div className="relative overflow-hidden rounded-xl border border-[rgba(124,255,168,0.3)] bg-bg-2 px-8 py-16 text-center md:px-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(50% 80% at 50% 0%, rgba(124,255,168,0.12), transparent 70%)',
          }}
        />
        <div className="relative">
          <span className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(124,255,168,0.5)] bg-bg text-mint">
            <Sparkle size={22} />
          </span>
          <h2 className="mx-auto max-w-2xl font-mono text-[30px] font-semibold leading-tight tracking-tight md:text-[40px]">
            Stop hand-writing the tests AI could explore for you.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-text-mute">
            Add Hover to your dev server in one command. Keep the deterministic
            Playwright files forever.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <CopyCommand />
            <a
              href={GITHUB}
              className="flex items-center gap-2 rounded-md border border-line px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
            >
              <GitHubGlyph /> Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-[13px] text-text-dim md:flex-row">
        <div className="flex items-center gap-2.5">
          <span className="text-mint">
            <Sparkle size={16} />
          </span>
          <span>Hover — © Hyperyond · Apache-2.0</span>
        </div>
        <div className="flex items-center gap-5">
          <a href={DOCS} className="transition-colors hover:text-text">
            Docs
          </a>
          <a href={GITHUB} className="transition-colors hover:text-text">
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/@hover-dev/cli"
            className="transition-colors hover:text-text"
          >
            npm
          </a>
        </div>
      </div>
    </footer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em] text-mint">
      <span className="h-1.5 w-1.5 rounded-full bg-mint" />
      {children}
    </div>
  );
}

function GitHubGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
