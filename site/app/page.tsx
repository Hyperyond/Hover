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
            v0.14 · latest release
          </a>

          <h1 className="font-mono text-[38px] font-semibold leading-[1.08] tracking-tight md:text-[52px]">
            AI authors the test.
            <br />
            <span className="text-mint">CI runs plain Playwright.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-text-mute md:text-[18px]">
            Describe a flow in plain English and watch AI drive your{' '}
            <em className="not-italic text-text">real</em> Chrome. When the run
            is clean, click <span className="text-text">Save as spec</span> —
            Hover writes a standard{' '}
            <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[14px] text-mint">
              @playwright/test
            </code>{' '}
            file that runs in CI with zero AI, forever.
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
            No API key, no per-token billing — Hover spawns the{' '}
            <span className="text-text-mute">claude</span> /{' '}
            <span className="text-text-mute">codex</span> CLI already on your{' '}
            <code className="font-mono text-text-mute">PATH</code>.
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
    title: 'BYO-CLI — reuse the subscription you have',
    body: 'Hover bundles no AI runtime. It spawns whatever coding-agent CLI is on your PATH — claude, codex, cursor-agent, aider — riding on the Pro / Max / ChatGPT plan you already pay for. No .env, no API key.',
  },
  {
    k: 'coverage',
    title: 'Five bundlers, three artifacts',
    body: 'Vite, Astro, Nuxt, Next.js (Turbopack), webpack 5 — plus React Native Web. Every verified session crystallises three ways: a Playwright spec, a replayable Skill, and a Jira-importable test case.',
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
    file: 'SKILL.md',
    name: 'Agent Skill',
    reader: 'Claude Code / agent',
    audience: 'Future you, exploring',
    accent: 'text-link',
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
      <SectionLabel>One exploration, three audiences</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        A single <span className="text-mint">Save as ▾</span> menu, three files
        that check into git.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Nothing lives in a vendor database. A spec written on a laptop on Monday
        is reviewed by QA on Tuesday and runs in CI from Wednesday — same file,
        no export step.
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
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

/* ── Security testing ───────────────────────────────────────────────────
 * Orange-themed (matching the @hover-dev/security plugin) so it reads as a
 * distinct mode, not part of the mint default flow. */
const SECURITY_CHECKS = [
  'IDOR — replay a captured URL with another user’s resource id',
  'Auth bypass — drop or swap the auth header',
  'Parameter tampering — mutate user_id / role / price / isAdmin',
  'Missing headers — CSP / X-Frame-Options / HSTS / SameSite',
  'PII leakage — user data in query strings or pre-consent requests',
];

function Security() {
  const orange = '#fb923c';
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <div
        className="relative overflow-hidden rounded-xl border bg-bg-2 px-8 py-12 md:px-14"
        style={{ borderColor: 'rgba(251,146,60,0.3)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 80% at 80% 0%, rgba(251,146,60,0.10), transparent 70%)',
          }}
        />
        <div className="relative grid gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Left — pitch */}
          <div>
            <div
              className="mb-4 flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.2em]"
              style={{ color: orange }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: orange }} />
              Optional plugin · @hover-dev/security
            </div>
            <h2 className="font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
              The same widget,{' '}
              <span style={{ color: orange }}>a security mode</span>.
            </h2>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-text-mute">
              Add{' '}
              <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px]" style={{ color: orange }}>
                @hover-dev/security
              </code>{' '}
              and the panel grows a Security mode. Hover routes your debug
              Chrome through a local HTTPS MITM, the agent inspects the captured
              API calls and replays them with mutations, and confirmed findings
              crystallise into{' '}
              <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-text">
                .security.spec.ts
              </code>{' '}
              regression tests that run in CI — no proxy, no agent. Today&rsquo;s
              IDOR becomes a gate on every PR.
            </p>
            <p className="mt-4 text-[13px] text-text-dim">
              Zero external deps — no mitmproxy, no Python, no system CA. Probes
              run on your own dev server; authorised testing only.
            </p>
          </div>

          {/* Right — what it probes */}
          <div className="rounded-lg border border-line bg-bg-3 p-6">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              What the agent probes for
            </div>
            <ul className="space-y-3">
              {SECURITY_CHECKS.map((c) => (
                <li key={c} className="flex items-start gap-3 text-[13.5px] leading-snug text-text-mute">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: orange }}
                  />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── On the roadmap ─────────────────────────────────────────────────────
 * Planned spec-output work (page objects, test.step, popup pairing, a
 * conventions file, a community seed library, an optional AI optimization pass).
 * Dashed borders + a Planned tag keep it visually apart from shipped features,
 * so nothing here reads as a current capability. */
const ROADMAP = [
  {
    title: 'Page objects from repeated flows',
    body: 'When a login or setup flow recurs across saved specs, Hover lifts it into a shared Page Object plus a fixture, so the selectors live in one file instead of five.',
  },
  {
    title: 'Structured test.step reports',
    body: 'Saved flows wrap their actions in Given / When / Then test.step calls, so the Playwright HTML report reads as named stages instead of a flat action list.',
  },
  {
    title: 'Multi-tab & popup flows',
    body: 'A click that opens a payment popup or OAuth tab crystallises with the Promise.all listener pairing Playwright needs, so the saved spec drives the new tab without a race.',
  },
  {
    title: 'Project conventions file',
    body: 'A .hover/conventions.md in your repo (which flows matter, where login lives, your preferred selectors) feeds the agent at exploration time, so generated specs follow your house style.',
  },
  {
    title: 'Community translation seeds',
    body: 'Hover translates actions off a library of worked examples — built-in for common patterns like popups and downloads, and extensible: you or the community add a seed to teach it a new pattern, no fork, no plugin code.',
  },
  {
    title: 'Optional AI optimization pass',
    body: 'Let AI read a generated spec and propose a polished version you accept via a diff. The deterministic original is always kept and the pass is off by default — nothing is rewritten behind your back.',
  },
];

function Roadmap() {
  return (
    <section id="roadmap" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>On the roadmap</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        Next, Hover shapes the output into a{' '}
        <span className="text-mint">maintainable suite</span>.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        None of this ships today. It&rsquo;s the next stretch for the saved spec:
        page objects, fixtures, and structured steps a team already maintains by
        hand &mdash; plus a community-extensible seed library and an optional AI
        polish pass that always keeps the deterministic original. All still plain
        Playwright with no agent in CI. Follow along on{' '}
        <a href={GITHUB} className="text-text underline-offset-2 hover:underline">
          GitHub
        </a>
        .
      </p>
      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {ROADMAP.map((r) => (
          <article
            key={r.title}
            className="rounded-lg border border-dashed border-line bg-bg-2 p-7"
          >
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-text-dim" />
              Planned
            </span>
            <h3 className="text-[17px] font-semibold tracking-tight text-text">{r.title}</h3>
            <p className="mt-3 text-[14px] leading-relaxed text-text-mute">{r.body}</p>
          </article>
        ))}
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
