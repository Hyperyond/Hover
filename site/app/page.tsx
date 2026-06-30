import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Sparkle } from '@/components/Sparkle';
import { McpDemo } from '@/components/McpDemo';
import { BusinessMapDemo } from '@/components/BusinessMapDemo';
import {
  InstallButton,
  CockpitButton,
  MCP_INSTALL,
  NPM_URL,
  MARKETPLACE_URL,
} from '@/components/InstallButton';
import { Waitlist } from '@/components/Waitlist';
import { Nav } from '@/components/Nav';
import { VideoSection } from '@/components/VideoSection';
import { Coverage } from '@/components/Coverage';
import { Comparison } from '@/components/Comparison';
import { Pricing } from '@/components/Pricing';
import { Faq } from '@/components/Faq';

/* The walkthrough lives on YouTube; the landing page only shows a poster that
 * links out (no self-hosted asset, no iframe on load). `asset()` appends a
 * content-hash cache-bust to the poster: a static path like /demo-poster.jpg
 * gets cached hard by the browser and Vercel's CDN, so swapping the file for a
 * same-named one would keep serving the stale image. Hashing the bytes at build
 * time means the URL changes only when the content changes. */
const PUBLIC = join(process.cwd(), 'public');

function asset(rel: string): string {
  const abs = join(PUBLIC, rel);
  if (!existsSync(abs)) return '';
  const hash = createHash('sha1').update(readFileSync(abs)).digest('hex').slice(0, 10);
  return `/${rel}?v=${hash}`;
}

const DEMO_VIDEO = 'https://www.youtube.com/watch?v=vAr74I9I9Ew';
const DEMO_POSTER = asset('demo-poster.jpg');

const GITHUB = 'https://github.com/Hyperyond/Hover';
const YOUTUBE = 'https://www.youtube.com/@hyperyond';
const DOCS = '/docs/';

/** SoftwareApplication structured data — the homepage's rich-result card and
 *  the node LLM answer engines quote when asked "what is Hover". It lives here
 *  (not in the sitewide layout) so it appears once, on the page it describes.
 *  featureList gives generative engines a clean, quotable feature enumeration.
 *  Every string must match the shipped product — these get cited verbatim.
 *  Hover is MCP-first: the authoring engine is an MCP server (@hover-dev/mcp)
 *  that plugs into the user's OWN coding agent — so it's a DeveloperApplication
 *  installed via npx, not a VS Code extension. The extension is the optional
 *  review cockpit. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://gethover.dev/#software',
  name: 'Hover',
  alternateName: 'Hover — open-source Vibe Testing suite',
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Test automation',
  operatingSystem: 'macOS, Windows, Linux (Node.js 20+)',
  description:
    'Hover is an open-source Vibe Testing suite built around an MCP server (@hover-dev/mcp). Add it to the coding agent you already run (Claude Code, Cursor, …) and the agent explores your app, maps its business flows, and crystallizes each one into a plain @playwright/test spec under __vibe_tests__/. The saved tests are yours — they run in your CI with zero AI in the loop. The differentiator is record == replay: the agent acts through Hover\'s grounded browser tools, so the selector that drove a click is the exact one saved, and crystallization is deterministic (no LLM writing code). Hover bundles no model and no keys (BYO-CLI). An optional VS Code extension adds a Business Map graph + Dashboard review cockpit.',
  url: 'https://gethover.dev/',
  downloadUrl: NPM_URL,
  installUrl: NPM_URL,
  softwareHelp: 'https://gethover.dev/docs/',
  license: 'https://www.apache.org/licenses/LICENSE-2.0',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': 'https://gethover.dev/#org' },
  author: { '@id': 'https://gethover.dev/#org' },
  keywords:
    'vibe testing, AI testing, MCP, Model Context Protocol, Playwright, end-to-end testing, test automation, BYO CLI, record equals replay, Claude Code, Cursor',
  featureList: [
    'An MCP server you add to your own coding agent (Claude Code, Cursor, …) — install with: claude mcp add hover -- npx -y @hover-dev/mcp',
    'The agent explores your app and crystallizes each flow into a standard @playwright/test spec',
    'record == replay — grounded actuation means the selector that drove a click is the exact one saved; crystallization is deterministic, no LLM writes code',
    'You own the artifact — plain @playwright/test in your repo, runs in your CI with zero AI, no proprietary format, no lock-in',
    'BYO-CLI — Hover bundles no model and no keys; it rides the coding agent and subscription you already pay for',
    'Optional VS Code cockpit — a Business Map graph of your flows + coverage and a Dashboard (pass / fail / flaky + CI results)',
    'CI integration — the crystallized specs run on every PR as plain Playwright; Hover can generate the workflow',
    'A living test wiki in .hover/ — a business map + remembered rules so the suite compounds as your app grows',
  ],
  sameAs: [GITHUB, NPM_URL, MARKETPLACE_URL],
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
      {/* Walkthrough video. The poster (public/demo-poster.jpg) links out to the
       * YouTube watch page — no self-hosted MP4, no iframe on load. */}
      <VideoSection watchUrl={DEMO_VIDEO} poster={DEMO_POSTER} />
      <Surfaces />
      <Why />
      <Cockpit />
      <Coverage />
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
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_minmax(400px,460px)] lg:gap-10">
        {/* Left — copy */}
        <div className="min-w-0">
          <a
            href={GITHUB}
            className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-bg-2 px-3.5 py-1.5 text-[12px] text-text-mute transition-colors hover:border-[rgba(124,255,168,0.4)] hover:text-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Open-source · MCP-first · Apache-2.0
          </a>

          <h1 className="font-mono text-[38px] font-semibold leading-[1.08] tracking-tight md:text-[52px]">
            Point your agent at Hover.
            <br />
            <span className="text-mint">Own the Playwright suite.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-text-mute md:text-[18px]">
            Hover is an open-source <em className="not-italic text-text">Vibe Testing</em>{' '}
            suite. Add its MCP server to the coding agent you already run; it
            explores your app and crystallizes each flow into a plain{' '}
            <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[14px] text-mint">
              @playwright/test
            </code>{' '}
            spec you own — running in CI with <em className="not-italic text-text">zero AI</em>.
          </p>

          <div id="install" className="mt-9 flex flex-col items-start gap-3">
            <InstallButton />
            <div className="flex flex-wrap items-center gap-3">
              <CockpitButton />
              <a
                href={DOCS}
                className="rounded-md border border-line px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
              >
                Read the docs →
              </a>
            </div>
          </div>

          <p className="mt-6 text-[13px] text-text-dim">
            <span className="text-mint">record == replay</span> — the selector
            that drove the click is the one that&rsquo;s saved. BYO-CLI: Hover
            bundles no model and no keys, riding the agent you already pay for.
          </p>
        </div>

        {/* Right — coding-agent + MCP session replica */}
        <div className="flex min-w-0 justify-center lg:justify-end">
          <McpDemo />
        </div>
      </div>
    </section>
  );
}

/* ── The four surfaces, one artifact ────────────────────────────────────
 * The suite's organizing thesis (mirrors the README "four surfaces" table):
 * MCP authors, the VS Code cockpit reviews, CI runs, Cloud (planned) watches.
 * The through-line is the owned Playwright artifact — the AI authors it once,
 * nothing AI runs after. */
const SURFACES = [
  {
    k: 'mcp',
    step: '01',
    stage: 'Author',
    surface: 'MCP',
    accent: '#7CFFA8',
    status: 'Shipped',
    title: 'Add it to your own agent',
    body: 'The engine. `@hover-dev/mcp` plugs into Claude Code, Cursor, or any MCP-capable agent. Run /mcp__hover__test_app and the agent explores your app and crystallizes specs — BYO-CLI, your model, your subscription, no keys of ours.',
  },
  {
    k: 'vscode',
    step: '02',
    stage: 'Review',
    surface: 'VS Code',
    accent: '#7dd3fc',
    status: 'Shipped',
    title: 'An optional review cockpit',
    body: 'A place to look — not the engine. The extension shows a Business Map graph of your app’s flows + coverage and a Dashboard (pass / fail / flaky + CI results), with one-click run. Install only if you want the visual surface.',
  },
  {
    k: 'ci',
    step: '03',
    stage: 'Run',
    surface: 'CI',
    accent: '#7CFFA8',
    status: 'Shipped',
    title: 'Runs as plain Playwright',
    body: 'The crystallized specs run on every PR as standard @playwright/test — no agent, no tokens, no key. Hover generates the GitHub Actions workflow for you and pulls the results back into the Dashboard.',
  },
  {
    k: 'cloud',
    step: '04',
    stage: 'Watch',
    surface: 'Cloud',
    accent: '#6b7280',
    status: 'Planned',
    title: 'Hosted parallel runs & self-heal',
    body: 'Optional, planned. A hosted layer over the specs you already own: parallel runs, scheduled monitoring, a flakiness dashboard, on-failure self-heal. Never authoring lock-in — the artifact stays yours.',
  },
];

function Surfaces() {
  return (
    <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 pb-8 pt-16 md:pt-24">
      <SectionLabel>The suite — one journey</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[26px] font-semibold leading-tight tracking-tight md:text-[34px]">
        <span className="text-mint">Author → Review → Run → Watch.</span>
        <br className="hidden md:block" />
        One pipeline, one artifact you own.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Four surfaces, one flow: the MCP <strong className="font-medium text-text">authors</strong>,
        the VS Code cockpit <strong className="font-medium text-text">reviews</strong>, CI{' '}
        <strong className="font-medium text-text">runs</strong>, and Cloud (planned){' '}
        <strong className="font-medium text-text">watches</strong>. The through-line is the artifact —
        portable{' '}
        <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-mint">
          @playwright/test
        </code>{' '}
        in your repo and your CI. The AI authors it once; nothing AI runs after.
      </p>

      {/* The journey at a glance — Author → Review → Run → Watch */}
      <div className="mt-8 flex flex-wrap items-center gap-y-2 font-mono text-[12px]">
        {SURFACES.map((s, i) => (
          <span key={s.k} className="inline-flex items-center">
            {i > 0 && <span className="px-2 text-text-dim" aria-hidden>→</span>}
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-bg-2 px-3 py-1.5">
              <span className="font-semibold" style={{ color: s.accent }}>{s.stage}</span>
              <span className="text-text-dim">· {s.surface}</span>
            </span>
          </span>
        ))}
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {SURFACES.map((s) => (
          <article
            key={s.k}
            className="flex flex-col rounded-lg border border-line bg-bg-2 p-6 transition-colors hover:border-line-2"
          >
            <div className="mb-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: s.accent }}>
              <span className="text-text-dim">{s.step}</span>
              <span className="font-semibold">{s.stage}</span>
              <span className="text-text-dim">· {s.surface}</span>
            </div>
            <h3 className="text-[16px] font-semibold tracking-tight text-text">{s.title}</h3>
            <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-text-mute">{s.body}</p>
            <span
              className={
                s.status === 'Shipped'
                  ? 'mt-5 inline-flex w-fit items-center gap-1.5 rounded-full border border-[rgba(124,255,168,0.35)] px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider text-mint'
                  : 'mt-5 inline-flex w-fit items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider text-text-dim'
              }
            >
              {s.status === 'Shipped' ? '✓ Shipped' : 'Planned'}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Why Hover ──────────────────────────────────────────────────────────
 * The moat, in four pillars (mirrors README "Why Hover"): record == replay,
 * you own the artifact, BYO-CLI, a living test wiki. */
const WHY = [
  {
    k: 'replay',
    title: 'record == replay',
    body: 'The agent acts through Hover’s grounded browser tools (role+name → testId → text), so the selector that drove a click is the exact one saved — and crystallization is deterministic, no LLM writing code. Playwright codegen / Stagehand / Midscene can’t guarantee this.',
  },
  {
    k: 'own',
    title: 'You own the artifact',
    body: 'Plain @playwright/test in your repo, running in your CI with zero AI. No proprietary format, no runtime dependency on Hover, no lock-in. The AI authors it once; the file is yours forever.',
  },
  {
    k: 'byo',
    title: 'BYO-CLI',
    body: 'Hover bundles no AI runtime and holds no key. It rides the coding agent + subscription you already pay for. We manage how to test, never which model — switch agents and nothing about your tests changes.',
  },
  {
    k: 'wiki',
    title: 'A living test wiki',
    body: 'Hover maintains a business map + remembered rules in .hover/, committed with your code. The suite compounds and stays self-aware as your app grows — your app’s test knowledge, owned and portable.',
  },
];

function Why() {
  return (
    <section id="why" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Why Hover</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        AI drives the browser once.{' '}
        <span className="text-mint">The test it leaves behind is yours.</span>
      </h2>
      <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
        {WHY.map((p, i) => (
          <article key={p.k} className="group bg-bg p-8 transition-colors hover:bg-bg-2">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg-3 font-mono text-[12px] text-mint">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="h-px flex-1 bg-line transition-colors group-hover:bg-[rgba(124,255,168,0.3)]" />
            </div>
            <h3 className="font-mono text-[18px] font-semibold tracking-tight text-text">
              {p.title}
            </h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-text-mute">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── VS Code cockpit ─────────────────────────────────────────────────────
 * The optional review surface, anchored by the Business Map graph. Framed as
 * a place to look — it drives no agent. */
function Cockpit() {
  return (
    <section id="cockpit" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>The cockpit (optional)</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        See every flow on a{' '}
        <span className="text-mint">Business Map</span>.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        The MCP is the whole authoring loop — but if you want a visual surface,
        the <span className="text-text">Hover VS Code extension</span> is a review
        cockpit. The Business Map graphs your app&rsquo;s areas and business lines,
        coloured by coverage, and links each covered flow to the spec it
        crystallized. A Dashboard shows pass / fail / flaky and your CI results.
        It drives no agent — it&rsquo;s a place to look.
      </p>
      <div className="mt-10">
        <BusinessMapDemo />
      </div>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <CockpitButton />
        <a
          href={DOCS}
          className="rounded-md border border-line px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
        >
          Read the docs →
        </a>
      </div>
    </section>
  );
}

/* ── Roadmap — shipped + planned ─────────────────────────────────────────
 * Today's reality: the MCP server + core are published on npm, the review
 * cockpit (Business Map + Dashboard) ships in the extension, and CI integration
 * is wired. Cloud + the living-wiki memory layer remain planned. */
const ROADMAP = [
  {
    status: 'shipped',
    title: 'The MCP server',
    body: '@hover-dev/mcp (and @hover-dev/core) published on npm. Add it to your own agent with one command; /mcp__hover__test_app explores + crystallizes a suite. BYO-CLI — no model, no keys of ours.',
  },
  {
    status: 'shipped',
    title: 'record == replay crystallize',
    body: 'Grounded actuation + deterministic crystallization: the agent acts through role+name tools, and Hover translates each recorded step to Playwright with no LLM writing code. What you replay is what you recorded.',
  },
  {
    status: 'shipped',
    title: 'The review cockpit',
    body: 'The Hover VS Code extension: a Business Map graph of your flows + coverage and a Dashboard (pass / fail / flaky + CI results), one-click run. Optional — it reviews, it doesn’t drive the agent.',
  },
  {
    status: 'shipped',
    title: 'CI integration',
    body: 'The crystallized specs run on every PR as plain Playwright — no agent, no tokens. Hover generates the GitHub Actions workflow and pulls the run results back into the Dashboard.',
  },
  {
    status: 'planned',
    title: 'A living test wiki',
    body: 'A business map + remembered rules in .hover/, committed with your code: Hover already knows which pages, forms, and endpoints a flow touches, flags coverage gaps, and keeps the suite self-aware as your app grows. No source uploaded.',
  },
  {
    status: 'planned',
    title: 'Hover Cloud',
    body: 'A hosted layer over the specs you already own: parallel runs, scheduled monitoring, a flakiness dashboard, and on-failure self-heal. Authoring stays local and free; CI still runs plain Playwright. Never authoring lock-in.',
  },
];

function Roadmap() {
  return (
    <section id="roadmap" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Shipped</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        An open-source suite, shipping{' '}
        <span className="text-mint">plain Playwright</span>.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        The MCP server and core are on npm, the review cockpit and CI integration
        ship today — all free and open-source. Next: a living test wiki, then
        Hover Cloud. Follow along on{' '}
        <a href={GITHUB} className="text-text underline-offset-2 hover:underline">
          GitHub
        </a>
        .
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {ROADMAP.map((r) => {
          const shipped = r.status === 'shipped';
          return (
            <article
              key={r.title}
              className={
                shipped
                  ? 'rounded-lg border border-[rgba(124,255,168,0.35)] bg-[rgba(124,255,168,0.04)] p-5'
                  : 'rounded-lg border border-dashed border-line bg-bg-2 p-5'
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
            Point your agent at Hover. Keep the Playwright.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-text-mute">
            One command adds the MCP to the agent you already run. The specs it
            crystallizes are yours — deterministic, in your repo, AI-free in CI.
          </p>
          <div className="mt-9 flex flex-col items-center gap-4">
            <InstallButton />
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={NPM_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-line px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
              >
                @hover-dev/mcp on npm
              </a>
              <a
                href={GITHUB}
                className="flex items-center gap-2 rounded-md border border-line px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
              >
                <GitHubGlyph /> Star on GitHub
              </a>
            </div>
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
          <a href={NPM_URL} target="_blank" rel="noreferrer" className="transition-colors hover:text-text">
            npm
          </a>
          <a
            href={YOUTUBE}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-text"
          >
            YouTube
          </a>
          <a href={MARKETPLACE_URL} className="transition-colors hover:text-text">
            VS Code
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
