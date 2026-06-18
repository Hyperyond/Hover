import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Sparkle } from '@/components/Sparkle';
import { WidgetDemo } from '@/components/WidgetDemo';
import { InstallButton, MARKETPLACE_URL } from '@/components/InstallButton';
import { Waitlist } from '@/components/Waitlist';
import { Nav } from '@/components/Nav';
import { VideoSection } from '@/components/VideoSection';
import { Coverage } from '@/components/Coverage';
import { Comparison } from '@/components/Comparison';
import { Pricing } from '@/components/Pricing';
import { Faq } from '@/components/Faq';
import { AskDemo } from '@/components/AskDemo';
import { EnvDemo } from '@/components/EnvDemo';

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
 *  Every string must match the shipped product — these get cited verbatim. */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://gethover.dev/#software',
  name: 'Hover',
  alternateName: 'Hover — AI Vibe Testing',
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Test automation',
  operatingSystem: 'Visual Studio Code (macOS, Windows, Linux)',
  description:
    'Hover is an open-source VS Code extension for AI vibe-testing web apps. You describe a flow in plain English; Hover drives your real Chrome over CDP using the coding-agent CLI already on your machine (Claude Code, OpenAI Codex, Gemini, or Qwen) on your own subscription or your own API key (BYOK), then crystallizes the verified run into a plain @playwright/test spec that runs in CI with zero AI and zero tokens. The same chat also flips into API-testing and pentest modes.',
  url: 'https://gethover.dev/',
  downloadUrl: MARKETPLACE_URL,
  softwareHelp: 'https://gethover.dev/docs/',
  license: 'https://www.apache.org/licenses/LICENSE-2.0',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@id': 'https://gethover.dev/#org' },
  author: { '@id': 'https://gethover.dev/#org' },
  keywords:
    'vibe testing, AI testing, Playwright, end-to-end testing, test automation, VS Code extension, AI security testing, pentest, IDOR, BYO CLI',
  featureList: [
    'Describe a flow in plain English; AI drives your real Chrome and crystallizes a standard @playwright/test spec',
    'CI runs plain Playwright with no AI, no tokens, and no API key',
    'Runs on the coding-agent CLI already on your PATH (Claude Code, OpenAI Codex, Gemini, Qwen) on your subscription, or BYOK with your own API key / gateway, or a local model',
    'Asks you in the chat when a step is ambiguous or destructive instead of guessing',
    'Multi-environment @account login; passwords stay in SecretStorage and parameterize into process.env',
    'API-testing mode replays captured API calls with mutations to catch IDOR and broken access control',
    'Pentest mode runs offensive checks (SQLi, XSS, SSTI, SSRF) against your own dev app and writes a report',
    'Optional AI optimize pass proposes a polished spec you accept via diff, original always kept',
  ],
  sameAs: [GITHUB, MARKETPLACE_URL],
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
      {/* Walkthrough video. The poster (public/demo-poster.jpg) links out to the
       * YouTube watch page — no self-hosted MP4, no iframe on load. */}
      <VideoSection watchUrl={DEMO_VIDEO} poster={DEMO_POSTER} />
      <Coverage />
      <Pillars />
      <Teammate />
      <MultiEnv />
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
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_minmax(400px,440px)] lg:gap-10">
        {/* Left — copy */}
        <div className="min-w-0">
          <a
            href={MARKETPLACE_URL}
            className="mb-7 inline-flex items-center gap-2 rounded-full border border-line bg-bg-2 px-3.5 py-1.5 text-[12px] text-text-mute transition-colors hover:border-[rgba(124,255,168,0.4)] hover:text-text"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            A free, open-source VS Code extension
          </a>

          <h1 className="font-mono text-[38px] font-semibold leading-[1.08] tracking-tight md:text-[52px]">
            Vibe-test your app.
            <br />
            <span className="text-mint">CI runs plain Playwright.</span>
          </h1>

          <p className="mt-7 max-w-xl text-[16px] leading-relaxed text-text-mute md:text-[18px]">
            Chat to a test in your editor. Describe a flow in plain English; AI
            drives your <em className="not-italic text-text">real</em> Chrome
            once to explore it. When the run&rsquo;s clean, Hover crystallises it
            into a standard{' '}
            <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[14px] text-mint">
              @playwright/test
            </code>{' '}
            spec that runs in CI with zero AI, forever.
          </p>

          <div id="install" className="mt-9 flex flex-wrap items-center gap-3">
            <InstallButton />
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
            Page objects, <span className="text-text-mute">test.step</span>{' '}
            stages, a built-in pattern library. Switch the same chat to{' '}
            <span style={{ color: '#fb923c' }}>🟠 API &amp; security</span> or{' '}
            <span style={{ color: '#f87171' }}>🔴 pentest</span> when you need it.{' '}
            <a href="#roadmap" className="text-text underline-offset-2 hover:underline">
              See what shipped
            </a>.
          </p>
        </div>

        {/* Right — live widget replica */}
        <div className="flex min-w-0 justify-center lg:justify-end">
          <WidgetDemo />
        </div>
      </div>

    </section>
  );
}

/* ── The triad: one widget, three AI jobs ───────────────────────────────
 * The page's organizing thesis. The three things the agent does for you —
 * author, optimize, secure — over ONE chat in your editor, with the crystallize
 * moat as the shared through-line: whatever the AI does, the artifact that lands
 * in your repo is plain @playwright/test that runs in CI with no AI. The
 * "secure" card is orange to match the 🟠 API testing mode; red is 🔴 Pentest. */
const TRIAD = [
  {
    k: 'frontend',
    tag: 'Frontend testing',
    accent: '#7CFFA8',
    title: 'Describe a flow → a plain Playwright spec',
    body: 'Type a flow in plain English. AI drives your real Chrome once to explore it, then crystallizes the run into a standard @playwright/test file — semantic getByRole / getByLabel selectors, page objects, named test.step stages.',
  },
  {
    k: 'api-security',
    tag: 'API & security',
    accent: '#fb923c',
    title: 'Probe your API for IDOR and authz gaps',
    body: 'Switch to orange. A local HTTPS MITM captures API calls; the agent replays them with mutations to find broken access control and IDOR. Confirmed findings crystallize into .api-test.spec.ts CI gates — no proxy, no Python.',
  },
  {
    k: 'pentest',
    tag: 'Pentest',
    accent: '#dc2626',
    title: 'Attack your own dev app for real vulns',
    body: 'Switch to red. The agent drives your app to capture traffic, then attacks the flows — SQLi, XSS, SSTI, SSRF, open redirect — on your own dev server. Writes a findings report with severity, PoC, and what was not tested.',
  },
];

function Triad() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 pb-8 pt-4 md:pt-8">
      <SectionLabel>One chat, three modes</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[26px] font-semibold leading-tight tracking-tight md:text-[34px]">
        <span className="text-mint">Frontend testing</span>,{' '}
        <span style={{ color: '#fb923c' }}>API &amp; security</span>, and{' '}
        <span style={{ color: '#dc2626' }}>pentest</span> — in one chat.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Switch modes as your needs grow. Whatever the AI does, the artifact in git is plain{' '}
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
    k: 'author',
    title: 'Describe the flow. Get a spec.',
    body: 'Say what to check in plain English. Hover drives your real Chrome to run it, and the moment it passes you have a standard @playwright/test file. It clicks through the app once so you stop testing by hand.',
  },
  {
    k: 'teammate',
    title: 'It works beside you in VS Code.',
    body: 'Hover runs as a chat in your editor. You watch each action land, it asks when a step is ambiguous, and it opens the spec it wrote for your review. You steer it the way you would a teammate sharing your screen.',
  },
  {
    k: 'byo',
    title: 'Runs on the Claude you already pay for.',
    body: 'Hover ships no model and holds no key. It spawns the claude or codex CLI already on your PATH, on the subscription you already have. You pay nothing extra, and nothing leaves your machine.',
  },
  {
    k: 'allinone',
    title: 'One extension for UI, API, and security.',
    body: 'Switch the same chat between three modes. Green drives the browser and writes a UI spec, orange replays your API to catch IDOR and broken access, red attacks your own dev app for real vulnerabilities. One install covers all three.',
  },
];

function Pillars() {
  return (
    <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Why Hover</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        You already pay for Claude.{' '}
        <span className="text-mint">Hover just makes it write your tests.</span>
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

function Teammate() {
  return (
    <section id="teammate" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Your AI testing teammate</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        It asks when it&rsquo;s unsure.{' '}
        <span className="text-mint">You decide.</span>
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Some calls a tool shouldn&rsquo;t make alone: which account to log in as,
        whether a step that deletes data should run. Hover stops and asks you in
        the chat, then continues with your answer. You stay in control without
        babysitting every click.
      </p>
      <div className="mt-10">
        <AskDemo />
      </div>
    </section>
  );
}

/* ── Multi-environment accounts ──────────────────────────────────────────
 * @-mention a test account in chat and Hover logs in, then writes the
 * credential as a process.env reference. The same spec runs on local, staging,
 * and production, each environment supplying its own secret in CI. Two synced
 * code animations (EnvDemo) carry the story: the chat on the left, the spec it
 * writes on the right. */
function MultiEnv() {
  return (
    <section id="environments" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Multi-environment, by name</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        Say <span className="text-mint">@account</span>. The same spec runs
        everywhere.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Define your test accounts once per environment. Mention one with{' '}
        <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-mint">@</code>{' '}
        in the chat and Hover logs in for you, then writes the password as a{' '}
        <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-text">process.env</code>{' '}
        reference, never a literal. The same file runs on local, staging, and
        production, and each environment hands CI its own secret.
      </p>
      <div className="mt-10">
        <EnvDemo />
      </div>
    </section>
  );
}

/* ── Structured output — shipped + what's next ──────────────────────────
 * The structured spec-output suite (page objects, test.step, popup pairing, a
 * conventions file, a built-in seed library, the optional AI optimization
 * pass) has landed on `main`, and the VS Code extension is live on the
 * Marketplace. Hover Cloud remains planned. Each card carries a `status` so
 * shipped vs planned renders distinctly. */
const ROADMAP = [
  {
    status: 'shipped',
    title: 'A VS Code extension',
    body: 'Chat panel, Conversations, Specs, Environments, Dashboard. Engine ships inside — no bundler plugin, no config in your app.',
  },
  {
    status: 'shipped',
    title: 'Asks you when it is unsure',
    body: 'Ambiguous step, destructive action, unclear account — the agent asks right in the editor instead of guessing or stalling.',
  },
  {
    status: 'shipped',
    title: 'Local CLI or BYOK',
    body: 'Drive runs with a CLI on your PATH (Claude Code, Codex, Gemini, Qwen) on your own subscription — or switch to BYOK and bring your own API key (Anthropic / OpenAI / Azure / Gemini, or an OpenAI-compatible gateway), which Hover injects into the matching CLI. Point either at a self-hosted endpoint for a local model. Keys stay in SecretStorage.',
  },
  {
    status: 'shipped',
    title: 'Multi-environment accounts',
    body: '@mention an account in chat and the agent logs in for you. Passwords stay in SecretStorage and parameterize into process.env — never written into the spec.',
  },
  {
    status: 'shipped',
    title: 'API testing & pentest modes',
    body: 'Orange: MITM-captured API calls replayed with mutations; findings crystallize into .api-test.spec.ts. Red: offensive vuln scan (SQLi / XSS / SSTI / SSRF) on your own app; writes a findings report.',
  },
  {
    status: 'shipped',
    title: 'Optional AI optimize pass',
    body: 'AI proposes a polished spec — page objects, named test.step stages, observed assertions — which you accept via diff. Original always kept; pass is off by default.',
  },
  {
    status: 'planned',
    title: 'It remembers your codebase',
    body: 'A local knowledge graph of your app and its tests. Before it writes a test, Hover already knows which pages, forms, and endpoints a flow touches; it flags coverage gaps and reruns only the specs a change affects. Stored on your machine, committed with your code, carried across any model. No source uploaded.',
  },
  {
    status: 'planned',
    title: 'Hover Cloud',
    body: 'A hosted layer over the specs and memory you build locally: a team-shared memory graph, parallel runs, scheduled monitoring, a flakiness dashboard, and AI self-heal on drift. Only graph metadata syncs, never your source or DOM. Authoring stays local and free; CI still runs plain Playwright.',
  },
];

function Roadmap() {
  return (
    <section id="roadmap" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
      <SectionLabel>Shipped</SectionLabel>
      <h2 className="mt-4 max-w-3xl font-mono text-[28px] font-semibold leading-tight tracking-tight md:text-[36px]">
        A real teammate in your editor, shipping{' '}
        <span className="text-mint">plain Playwright</span>.
      </h2>
      <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-mute">
        Every feature that ships is in the VS Code extension today, free and
        open-source. Next: a local memory graph, then Hover Cloud. Follow along on{' '}
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
            Stop hand-writing the tests AI could explore for you.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-text-mute">
            Install the VS Code extension. Keep the deterministic Playwright
            files forever.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <InstallButton />
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
            href={YOUTUBE}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-text"
          >
            YouTube
          </a>
          <a
            href={MARKETPLACE_URL}
            className="transition-colors hover:text-text"
          >
            Install
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
