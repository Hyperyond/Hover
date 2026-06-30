'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * A light mock of a GitHub PR "checks" panel for the Acme Store example: the
 * crystallized specs run on every PR as plain @playwright/test — no agent, no
 * tokens, no key. Visual tokens mirror the site design system (near-black
 * surface, mint pass ticks, mono). The spec names here match the ones McpDemo
 * crystallizes and BusinessMapDemo shows covered (Log in / Add to cart /
 * Checkout). Pure HTML/CSS + a small reveal animation; no new deps.
 */

const MINT = '#7CFFA8';

type Spec = { file: string; title: string; ms: number };

// The six checks under the "Hover E2E" run — the three crystallized flows plus
// a few sibling specs, so the panel reads like a real suite rather than a stub.
const SPECS: Spec[] = [
  { file: 'login.spec.ts', title: 'log in', ms: 1840 },
  { file: 'add-to-cart.spec.ts', title: 'add to cart', ms: 2110 },
  { file: 'checkout.spec.ts', title: 'checkout', ms: 3260 },
  { file: 'signup.spec.ts', title: 'sign up', ms: 1670 },
  { file: 'search.spec.ts', title: 'search products', ms: 940 },
  { file: 'profile.spec.ts', title: 'edit profile', ms: 1280 },
];

const REVEAL_MS = 380; // delay between each check ticking green

export function CiDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  // How many checks have "passed" (ticked green). Reduced motion → all at once.
  const [passed, setPassed] = useState(0);

  useEffect(() => {
    if (reduced) {
      setPassed(SPECS.length);
      return;
    }
    if (!run) {
      setPassed(0);
      return;
    }
    if (passed >= SPECS.length) return;
    const id = setTimeout(() => setPassed((p) => p + 1), passed === 0 ? 200 : REVEAL_MS);
    return () => clearTimeout(id);
  }, [run, reduced, passed]);

  const allDone = passed >= SPECS.length;

  return (
    <div ref={rootRef} className="w-full">
      <div className="overflow-hidden rounded-xl border border-line bg-bg-3 font-mono text-[12.5px] text-text">
        {/* Title bar — mirrors a GitHub checks panel header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 text-text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            Checks · #128 Add Acme Store E2E suite
          </div>
          <span className="text-[11px] text-text-dim">GitHub Actions</span>
        </div>

        {/* The single Hover E2E check, with its spec children */}
        <div className="px-3 py-3">
          <div className="flex items-center justify-between rounded-md border border-line bg-bg-2 px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <Tick on={allDone} />
              <span className="text-text">Hover E2E / playwright</span>
            </div>
            <span
              className="rounded-full border px-2.5 py-0.5 text-[10.5px] uppercase tracking-wider"
              style={
                allDone
                  ? { borderColor: 'rgba(124,255,168,0.4)', color: MINT }
                  : { borderColor: 'var(--color-line-2)', color: 'var(--color-text-dim)' }
              }
            >
              {allDone ? `${SPECS.length} passed` : 'running…'}
            </span>
          </div>

          {/* Spec rows */}
          <div className="mt-2 flex flex-col gap-0.5 pl-2">
            {SPECS.map((s, i) => {
              const done = i < passed;
              return (
                <div
                  key={s.file}
                  className="flex items-center justify-between rounded px-2 py-1.5 transition-colors"
                  style={{ opacity: done ? 1 : 0.45 }}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Tick on={done} small />
                    <span className="truncate text-text-mute">
                      <span className="text-text">{s.file}</span>
                      <span className="text-text-dim"> › {s.title}</span>
                    </span>
                  </div>
                  <span className="shrink-0 pl-3 text-[11px] text-text-dim">
                    {done ? `${(s.ms / 1000).toFixed(1)}s` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer summary — the honest line: plain Playwright, zero AI */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11px] text-text-dim">
          <span>
            {allDone ? (
              <>
                <span className="text-mint">✓ All checks passed</span> · {SPECS.length} specs
              </>
            ) : (
              <>Running {SPECS.length} specs…</>
            )}
          </span>
          <span>plain @playwright/test · zero AI</span>
        </div>
      </div>
    </div>
  );
}

/* A check circle: mint filled + ✓ when on, hollow gray ring while pending. */
function Tick({ on, small }: { on: boolean; small?: boolean }) {
  const d = small ? 15 : 17;
  if (!on) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full border"
        style={{ width: d, height: d, borderColor: 'var(--color-line-2)' }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: d,
        height: d,
        background: 'rgba(124,255,168,0.14)',
        border: `1px solid ${MINT}`,
        color: MINT,
        fontSize: small ? 9 : 10,
        fontWeight: 700,
      }}
    >
      ✓
    </span>
  );
}
