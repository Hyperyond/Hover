'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The explore → crystallise → optimise story as a self-typing terminal panel,
 * styled like the widget's dark inset code blocks. The prompt types in, the
 * left-rail steps light up, and the spec on the right reveals line by line — as
 * if Hover were generating it live.
 *
 * Two kinds of scene:
 *   • basic   — type → deterministic spec reveals → hold. (login-flow)
 *   • pass    — type → naive DRAFT reveals → an "✦ Optimize pass" step fires →
 *               the racy lines are rewritten in place into a `Promise.all([…])`
 *               pairing (removed lines struck red, added lines mint). This is the
 *               download / file-chooser / popup case: the event listener must be
 *               registered BEFORE the action or it races and flakes; the
 *               optimisation pass pairs them. It's what makes the demo *show* the
 *               pipeline-code optimisation, not just claim it.
 *
 * Each spec is the shape writeSpec.ts emits — getByLabel / getByRole semantic
 * selectors, every interaction wrapped in a visibility guard, relative goto,
 * JSON.stringify quote style. The JSDoc header the emitter writes is omitted
 * here on purpose: the demo is about the *code*, and the header just adds noise.
 *
 * SSR-safe: initial state shows the first scene's final frame in full, so
 * crawlers and reduced-motion / no-JS visitors read a complete spec. The mount
 * effect rewinds to the animated start only when motion is allowed.
 */

type Line = { text: string; tag?: 'del' | 'add' };
type Step = { label: string; at?: number; phase?: 'pass' | 'hold'; glyph?: string };
type Scene = {
  file: string;
  prompt: string;
  pass?: boolean;
  steps: Step[];
  spec: Line[];
};

const SCENES: Scene[] = [
  {
    file: '__vibe_tests__/export-csv.spec.ts',
    prompt: 'export the sales report as CSV',
    pass: true,
    steps: [
      { label: 'Opening reports', at: 4 },
      { label: 'Clicking Export CSV', at: 6 },
      { label: 'Capturing download', at: 9 },
      { label: 'Optimize pass', phase: 'pass', glyph: '✦' },
      { label: 'Done · 8 steps · $0.05', phase: 'hold' },
    ],
    spec: [
      { text: `import { test, expect } from '@playwright/test';` },
      { text: `` },
      { text: `test('export sales report', async ({ page }) => {` },
      { text: `  await page.goto("/reports");` },
      { text: `` },
      { text: `  await page.getByRole('button',`, tag: 'del' },
      { text: `    { name: "Export CSV" }).click();`, tag: 'del' },
      { text: `  const download =`, tag: 'del' },
      { text: `    await page.waitForEvent('download');`, tag: 'del' },
      { text: `  const [ download ] =`, tag: 'add' },
      { text: `    await Promise.all([`, tag: 'add' },
      { text: `      page.waitForEvent('download'),`, tag: 'add' },
      { text: `      page.getByRole('button',`, tag: 'add' },
      { text: `        { name: "Export CSV" }).click(),`, tag: 'add' },
      { text: `    ]);`, tag: 'add' },
      { text: `` },
      { text: `  expect(download.suggestedFilename())` },
      { text: `    .toContain(".csv");` },
      { text: `});` },
    ],
  },
  {
    file: '__vibe_tests__/upload-avatar.spec.ts',
    prompt: 'upload my profile avatar',
    pass: true,
    steps: [
      { label: 'Opening settings', at: 4 },
      { label: 'Clicking Upload avatar', at: 6 },
      { label: 'Capturing file chooser', at: 9 },
      { label: 'Optimize pass', phase: 'pass', glyph: '✦' },
      { label: 'Done · 6 steps · $0.04', phase: 'hold' },
    ],
    spec: [
      { text: `import { test, expect } from '@playwright/test';` },
      { text: `` },
      { text: `test('upload avatar', async ({ page }) => {` },
      { text: `  await page.goto("/settings");` },
      { text: `` },
      { text: `  await page.getByText("Upload avatar")`, tag: 'del' },
      { text: `    .click();`, tag: 'del' },
      { text: `  const chooser =`, tag: 'del' },
      { text: `    await page.waitForEvent('filechooser');`, tag: 'del' },
      { text: `  const [ chooser ] =`, tag: 'add' },
      { text: `    await Promise.all([`, tag: 'add' },
      { text: `      page.waitForEvent('filechooser'),`, tag: 'add' },
      { text: `      page.getByText("Upload avatar").click(),`, tag: 'add' },
      { text: `    ]);`, tag: 'add' },
      { text: `  await chooser.setFiles("avatar.png");` },
      { text: `});` },
    ],
  },
  {
    file: '__vibe_tests__/oauth-login.spec.ts',
    prompt: 'sign in with Google',
    pass: true,
    steps: [
      { label: 'Opening login', at: 4 },
      { label: 'Clicking Continue with Google', at: 8 },
      { label: 'Capturing popup', at: 10 },
      { label: 'Optimize pass', phase: 'pass', glyph: '✦' },
      { label: 'Done · 7 steps · $0.06', phase: 'hold' },
    ],
    spec: [
      { text: `import { test, expect } from '@playwright/test';` },
      { text: `` },
      { text: `test('sign in with Google', async ({ page }) => {` },
      { text: `  await page.goto("/login");` },
      { text: `` },
      { text: `  await page.getByRole('button',`, tag: 'del' },
      { text: `    { name: "Continue with Google" })`, tag: 'del' },
      { text: `    .click();`, tag: 'del' },
      { text: `  const popup =`, tag: 'del' },
      { text: `    await page.waitForEvent('popup');`, tag: 'del' },
      { text: `  const [ popup ] =`, tag: 'add' },
      { text: `    await Promise.all([`, tag: 'add' },
      { text: `      page.waitForEvent('popup'),`, tag: 'add' },
      { text: `      page.getByRole('button', {`, tag: 'add' },
      { text: `        name: "Continue with Google" })`, tag: 'add' },
      { text: `        .click(),`, tag: 'add' },
      { text: `    ]);`, tag: 'add' },
      { text: `  await popup.getByLabel("Email")` },
      { text: `    .fill("ada@…");` },
      { text: `});` },
    ],
  },
];

type Phase = 'static' | 'typing' | 'building' | 'pass' | 'hold';

const SAME = 'text-text-mute';
const ADD = 'text-mint';
const DEL = 'text-[#e06c75] line-through opacity-50';

export function TerminalDemo() {
  const [sceneIdx, setSceneIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('static');
  const [typed, setTyped] = useState(SCENES[0].prompt);
  const [lines, setLines] = useState(SCENES[0].spec.length);
  const [passApplied, setPassApplied] = useState(true);

  const scene = SCENES[sceneIdx];
  const draftLines = scene.spec.filter((l) => l.tag !== 'add');
  const finalLines = scene.spec.filter((l) => l.tag !== 'del');
  const preRef = useRef<HTMLPreElement>(null);

  // On mount, rewind to the animated start unless the user prefers less motion.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setTyped('');
    setLines(0);
    setPassApplied(false);
    setPhase('typing');
  }, []);

  // Prompt typewriter.
  useEffect(() => {
    if (phase !== 'typing') return;
    const prompt = SCENES[sceneIdx].prompt;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(prompt.slice(0, i));
      if (i >= prompt.length) {
        clearInterval(id);
        setPhase('building');
      }
    }, 32);
    return () => clearInterval(id);
  }, [phase, sceneIdx]);

  // Draft revealed one line at a time (the naive, pre-optimisation version).
  useEffect(() => {
    if (phase !== 'building') return;
    const total = SCENES[sceneIdx].spec.filter((l) => l.tag !== 'add').length;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setLines(n);
      if (n >= total) {
        clearInterval(id);
        setPhase(SCENES[sceneIdx].pass ? 'pass' : 'hold');
      }
    }, 110);
    return () => clearInterval(id);
  }, [phase, sceneIdx]);

  // Optimise pass: hold the draft a beat, then rewrite the racy lines in place.
  useEffect(() => {
    if (phase !== 'pass') return;
    setPassApplied(false);
    const t1 = setTimeout(() => setPassApplied(true), 700);
    const t2 = setTimeout(() => setPhase('hold'), 2400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase, sceneIdx]);

  // Hold the finished frame, then advance to the next scene and loop.
  useEffect(() => {
    if (phase !== 'hold') return;
    const id = setTimeout(() => {
      setSceneIdx((s) => (s + 1) % SCENES.length);
      setTyped('');
      setLines(0);
      setPassApplied(false);
      setPhase('typing');
    }, 3000);
    return () => clearTimeout(id);
  }, [phase]);

  // Follow the freshly-drawn / rewritten line while building or applying the
  // pass; on hold, rest at the bottom a beat then ease back to the top so the
  // optimised frame reads top-down. typing/static reset flat.
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    if (phase === 'building' || (phase === 'pass' && passApplied)) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (phase !== 'hold') {
      el.scrollTop = 0;
      return;
    }
    const id = setTimeout(() => {
      preRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 900);
    return () => clearTimeout(id);
  }, [phase, lines, passApplied]);

  const stepState = (step: Step, idx: number): 'pending' | 'running' | 'done' => {
    if (phase === 'static') return 'done';
    if (step.phase === 'pass') {
      if (phase === 'hold') return 'done';
      if (phase === 'pass') return passApplied ? 'done' : 'running';
      return 'pending';
    }
    if (step.phase === 'hold') return phase === 'hold' ? 'done' : 'pending';
    // build step keyed by draft-line count
    if (phase === 'pass' || phase === 'hold') return 'done';
    if (phase === 'typing') return 'pending';
    const at = step.at ?? 0;
    if (lines >= at) return 'done';
    const prevAt = idx === 0 ? 0 : scene.steps[idx - 1].at ?? 0;
    return lines >= prevAt ? 'running' : 'pending';
  };

  // The right-panel lines + their colour class, per phase.
  const visible: { text: string; cls: string }[] = (() => {
    if (phase === 'static' || phase === 'hold') {
      return finalLines.map((l) => ({ text: l.text, cls: l.tag === 'add' ? ADD : SAME }));
    }
    if (phase === 'typing') return [];
    if (phase === 'building') return draftLines.slice(0, lines).map((l) => ({ text: l.text, cls: SAME }));
    // pass
    if (!passApplied) return draftLines.map((l) => ({ text: l.text, cls: SAME }));
    return scene.spec.map((l) => ({
      text: l.text,
      cls: l.tag === 'del' ? DEL : l.tag === 'add' ? ADD : SAME,
    }));
  })();

  const rightLabel =
    phase === 'pass' ? (
      <span className="text-mint">✦ Optimize pass</span>
    ) : (
      <>
        Hover saves <span className="text-mint">{scene.file}</span>
      </>
    );

  return (
    <div className="mt-16 overflow-hidden rounded-lg border border-line bg-bg-3 shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
      <div className="flex items-center gap-2 border-b border-line bg-bg-2 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-line-2" />
        <span className="h-3 w-3 rounded-full bg-line-2" />
        <span className="h-3 w-3 rounded-full bg-line-2" />
        <span className="ml-2 font-mono text-[12px] text-text-dim">hover · examples</span>
        {/* Scene dots — which of the looping flows is on screen. */}
        <span className="ml-auto flex items-center gap-1.5">
          {SCENES.map((s, i) => (
            <span
              key={s.file}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === sceneIdx ? 'bg-mint' : 'bg-line-2'}`}
            />
          ))}
        </span>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-2">
        {/* Left — you type */}
        <div className="min-w-0 bg-bg-3 p-5">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-text-dim">
            You type
          </div>
          <p className="min-h-[3em] font-mono text-[14px] leading-relaxed text-text">
            <span className="text-mint">› </span>
            {typed}
            {phase === 'typing' && <Caret />}
          </p>
          <div className="mt-5 space-y-2 font-mono text-[13px] text-text-mute">
            {scene.steps.map((s, i) => (
              <StepRow key={s.label} label={s.label} glyph={s.glyph} state={stepState(s, i)} last={i === scene.steps.length - 1} />
            ))}
          </div>
        </div>
        {/* Right — Hover saves / optimises */}
        <div className="min-w-0 bg-bg-3 p-5">
          <div className="mb-3 break-all font-mono text-[11px] uppercase tracking-wider text-text-dim">
            {rightLabel}
          </div>
          <pre ref={preRef} className="td-pre h-108 overflow-auto font-mono text-[12.5px] leading-relaxed text-text-mute">
            <code>
              {visible.map((l, i) => (
                <div key={i} className={`${l.cls} transition-colors duration-300`}>
                  {l.text || ' '}
                </div>
              ))}
              {phase === 'building' && <Caret />}
            </code>
          </pre>
          <div className="mt-3 font-mono text-[11px] text-text-dim">
            runs with <span className="text-text-mute">npx playwright test</span> — no agent, no AI
          </div>
        </div>
      </div>

      <style>{`
        @keyframes td-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        /* Scrollbar matched to the real widget (style.css): thin, dark thumb,
           transparent track — so a long selector line scrolls quietly instead
           of showing the OS default bar. */
        .td-pre { scrollbar-width: thin; scrollbar-color: #2a2a2c transparent; }
        .td-pre::-webkit-scrollbar { width: 8px; height: 8px; }
        .td-pre::-webkit-scrollbar-track { background: transparent; }
        .td-pre::-webkit-scrollbar-thumb {
          background: #2a2a2c; border-radius: 999px;
          border: 2px solid transparent; background-clip: padding-box;
        }
        .td-pre::-webkit-scrollbar-thumb:hover { background: #3a3a3c; background-clip: padding-box; }
      `}</style>
    </div>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1.05em] w-0.5 translate-y-0.5 bg-mint align-middle"
      style={{ animation: 'td-blink 0.9s steps(2) infinite' }}
    />
  );
}

function StepRow({
  label,
  state,
  last,
  glyph,
}: {
  label: string;
  state: 'pending' | 'running' | 'done';
  last?: boolean;
  glyph?: string;
}) {
  const lit = state !== 'pending';
  const text = !lit ? undefined : last || glyph ? 'text-mint' : state === 'running' ? 'text-text' : undefined;
  return (
    <div
      className="flex items-center gap-2.5 transition-opacity duration-300"
      style={{ opacity: state === 'pending' ? 0.3 : 1 }}
    >
      {glyph ? (
        <span className={`text-[11px] leading-none ${lit ? 'text-mint' : 'text-line-2'}`}>{glyph}</span>
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${lit ? 'bg-mint' : 'bg-line-2'}`} />
      )}
      <span className={text}>{label}</span>
    </div>
  );
}
