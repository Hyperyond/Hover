---
layout: home

hero:
  name: Hover
  text: AI that hovers over your dev workflow
  tagline: Speak or type natural-language instructions. Watch the agent drive your dev browser. Crystallize the verified session into a Playwright spec, a Skill, or a Jira case.
  actions:
    - theme: brand
      text: Get started →
      link: /get-started/
    - theme: alt
      text: View on GitHub
      link: https://github.com/Hyperyond/Hover

features:
  - icon: 🎙️
    title: Voice mode (v0.6.0)
    details: Push-to-talk speech input. Hold the mic, dictate your instruction in 中文 or English, release to fire. Step events get spoken back to you so you can keep your eyes on the page. Browser-native, no API keys.
    link: /features/voice-mode
    linkText: Try Voice mode
  - icon: 🤖
    title: Multi-agent — claude, codex, more
    details: Hover spawns whichever coding-agent CLI you have on PATH. Subscription you already pay for — no per-token billing. One-click switching from the widget header.
    link: /get-started/agents
    linkText: Pick your agent
  - icon: 💾
    title: Crystallize into Playwright
    details: One click saves the verified flow as a standard `@playwright/test` spec under `__vibe_tests__/`. No proprietary format. Runs in CI without Hover in the loop.
    link: /features/save-as-spec
    linkText: Save as Spec
  - icon: 🔍
    title: Click → Fix prompt
    details: Click any element on the page. Type what you'd like to change. Hover assembles a precise prompt — source line:col, ancestor chain, Playwright selector, React component chain — onto your clipboard.
    link: /features/fix-prompt
    linkText: Try Fix prompt
  - icon: 🐛
    title: Bug discovery as a first-class output
    details: The agent's verification report and any bugs it finds get their own cards at the end of the run, separated from the step-by-step timeline. Severity-coloured.
    link: /features/findings-cards
    linkText: See Findings cards
  - icon: 📦
    title: Works with your bundler
    details: Vite, Astro, Nuxt, Next.js (Turbopack), Webpack 5, React Native Web. `npx @hover-dev/cli add` picks the right integration based on your `package.json`.
    link: /get-started/install
    linkText: Install
---

<div class="banner-wrap">
  <img src="/banner.png" alt="Hover widget floating over a dev page" />
</div>

<style scoped>
  .banner-wrap {
    max-width: 1152px;
    margin: 32px auto 48px;
    padding: 0 24px;
  }
  .banner-wrap img {
    width: 100%;
    height: auto;
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
  }
  @media (max-width: 768px) {
    .banner-wrap { padding: 0 16px; margin: 16px auto 32px; }
  }
</style>

## Quick demo

Two terminals on first run, then loop:

```bash
# Terminal 1 — boots dev server + auto-launches isolated debug Chrome
pnpm dev:example:basic-app

# Terminal 2 — invoke the agent
pnpm smoke "test the login flow"
```

The widget appears in the bottom-right of the dev page. Hold the 🎙 button or type your prompt; the agent drives the debug Chrome over CDP, narrates each step, and renders a Result + Findings card at the end. Click **Save as Spec** and the verified flow becomes a `__vibe_tests__/<slug>.spec.ts` file that runs in your CI like any other Playwright test.

## Why Hover

| Other tools | Hover |
|---|---|
| Cloud-hosted agent + browser farm + per-token billing | Your local CLI agent + your dev browser. No new keys, no per-token bill. |
| Proprietary recording format that lives in their cloud | Standard `@playwright/test` files in your repo. CI runs without Hover. |
| AI runs the test forever (flaky, slow) | AI explores once → crystallizes into a deterministic script. Best of both. |

[Read the full pitch →](/get-started/)
