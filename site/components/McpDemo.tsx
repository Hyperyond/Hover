'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, usePrefersReducedMotion } from '@/lib/useInView';

/**
 * An auto-playing replica of a coding-agent session (Claude Code / Cursor /
 * Codex) driving Hover's MCP. Visual tokens mirror the site design system
 * (near-black surface, mint accent, mono). This is the hero-right visual that
 * replaces the old in-page-widget WidgetDemo: it shows the MCP-first loop —
 * the user invokes /mcp__hover__test_app, the agent streams *grounded* tool
 * calls, and Hover crystallizes plain Playwright specs.
 *
 * The point it makes visually: the agent acts through grounded *_control tools
 * (role+name, the exact selector that lands in the spec), so record == replay.
 */

type LineKind =
  | 'user' // the slash-command the user types
  | 'narrate' // AI narration line (mint dot)
  | 'tool' // a grounded tool call (muted mono)
  | 'map' // an induced business line (chip row under the mapping narration)
  | 'wrote' // a crystallized spec (mint ✓)
  | 'done'; // final summary

type Line = { kind: LineKind; text: string };

/* One scripted session, run against the Acme Store example (shop.acme.dev).
 * The tool lines are the grounded actuation surface — browser_navigate to
 * explore, then click_control / fill_control whose role+name target is exactly
 * what gets written into the spec. The crystallized spec names here MUST match
 * the covered flows in BusinessMapDemo (Log in / Add to cart / Checkout). */
const SCRIPT: Line[] = [
  { kind: 'user', text: '/mcp__hover__test_app  shop.acme.dev' },
  { kind: 'narrate', text: 'Exploring Acme Store…' },
  { kind: 'tool', text: 'browser_navigate  →  /login' },
  { kind: 'tool', text: 'fill_control  "Email"  →  shopper@acme.test' },
  { kind: 'tool', text: 'fill_control  "Password"  →  ••••••••' },
  { kind: 'tool', text: 'click_control  "Log in"' },
  { kind: 'tool', text: 'browser_navigate  →  /products' },
  { kind: 'tool', text: 'click_control  "Add to cart"' },
  { kind: 'tool', text: 'click_control  "Checkout"' },
  // The key insight: before recording clicks, the agent groups what it found
  // into the app's business lines and writes the map artifact.
  { kind: 'narrate', text: 'Mapping the business lines…' },
  { kind: 'map', text: 'Auth · Commerce · Account' },
  { kind: 'tool', text: 'found 7 flows across 3 areas' },
  { kind: 'wrote', text: 'wrote  .hover/hover-map.md' },
  { kind: 'narrate', text: 'Crystallizing the covered flows…' },
  { kind: 'wrote', text: 'crystallized  login.spec.ts' },
  { kind: 'wrote', text: 'crystallized  add-to-cart.spec.ts' },
  { kind: 'wrote', text: 'crystallized  checkout.spec.ts' },
  {
    kind: 'done',
    text: 'Business map + 3 specs written — plain @playwright/test, zero AI at runtime.',
  },
];

const TYPE_MS = 32; // typewriter speed for the user command
const LINE_MS = 620; // delay between streamed agent lines
const HOLD_MS = 3200; // pause on the completed transcript before looping

export function McpDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef);
  const reduced = usePrefersReducedMotion();
  const run = inView && !reduced;

  // `visible` = how many SCRIPT lines are revealed. The first line (user
  // command) types in; the rest stream one per LINE_MS tick.
  const [visible, setVisible] = useState(0);
  const [typed, setTyped] = useState('');

  // Reduced motion: show the whole completed transcript, no timers.
  useEffect(() => {
    if (reduced) {
      setVisible(SCRIPT.length);
      setTyped(SCRIPT[0].text);
    }
  }, [reduced]);

  // Typewriter for the user command (visible === 0 → typing line 0).
  useEffect(() => {
    if (!run || visible !== 0) return;
    let i = 0;
    setTyped('');
    const id = setInterval(() => {
      i++;
      setTyped(SCRIPT[0].text.slice(0, i));
      if (i >= SCRIPT[0].text.length) {
        clearInterval(id);
        setTimeout(() => setVisible(1), 420);
      }
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [run, visible]);

  // Stream the agent lines, then hold and loop.
  useEffect(() => {
    if (!run || visible === 0) return;
    if (visible >= SCRIPT.length) {
      const id = setTimeout(() => {
        setVisible(0);
        setTyped('');
      }, HOLD_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setVisible((v) => v + 1), LINE_MS);
    return () => clearTimeout(id);
  }, [run, visible]);

  // Keep the transcript scrolled to the newest line.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [visible, typed]);

  const lines = SCRIPT.slice(0, Math.max(visible, 1));

  return (
    <div ref={rootRef} className="select-none" style={{ width: 420, maxWidth: '100%' }}>
      <div
        className="overflow-hidden rounded-xl shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
        style={{
          background: '#1a1a1a',
          border: '1px solid #2a2a2c',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          fontSize: 12.5,
          color: '#e5e7eb',
        }}
      >
        {/* Header — terminal traffic lights + agent pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 12px',
            borderBottom: '1px solid #2a2a2c',
          }}
        >
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {['#fb5f57', '#fdbc2e', '#28c840'].map((c) => (
              <span
                key={c}
                style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.85 }}
              />
            ))}
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 9px',
              border: '1px solid #2a2a2c',
              borderRadius: 7,
              background: '#222224',
              color: '#9ca3af',
              fontSize: 11,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#7CFFA8' }} />
            claude · hover MCP · shop.acme.dev
          </span>
        </div>

        {/* Transcript */}
        <div
          ref={logRef}
          className="mcpdemo-log"
          style={
            {
              height: 372,
              overflowY: 'auto',
              padding: '14px 14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
            } as React.CSSProperties
          }
        >
          {lines.map((line, i) => {
            const isLastVisible = i === lines.length - 1;
            const typing = i === 0 && visible === 0;
            return (
              <LineRow
                key={i}
                line={line}
                text={typing ? typed : line.text}
                typing={typing}
                streaming={isLastVisible && line.kind !== 'done' && visible < SCRIPT.length}
              />
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes mcpdemo-blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes mcpdemo-in { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
        .mcpdemo-log::-webkit-scrollbar { width: 4px; }
        .mcpdemo-log::-webkit-scrollbar-track { background: transparent; }
        .mcpdemo-log::-webkit-scrollbar-thumb { background: #2a2a2c; border-radius: 4px; }
        .mcpdemo-log { scrollbar-width: thin; scrollbar-color: #2a2a2c transparent; }
      `}</style>
    </div>
  );
}

function LineRow({
  line,
  text,
  typing,
  streaming,
}: {
  line: Line;
  text: string;
  typing: boolean;
  streaming: boolean;
}) {
  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    lineHeight: 1.5,
    animation: typing ? 'none' : 'mcpdemo-in 0.22s ease both',
  };

  if (line.kind === 'user') {
    return (
      <div style={style}>
        <span style={{ color: '#7CFFA8', flexShrink: 0 }}>›</span>
        <span style={{ color: '#e5e7eb' }}>
          {text}
          {typing && (
            <span style={{ marginLeft: 1, animation: 'mcpdemo-blink 0.9s steps(2) infinite' }}>
              ▌
            </span>
          )}
        </span>
      </div>
    );
  }

  if (line.kind === 'narrate') {
    return (
      <div style={{ ...style, marginTop: 4 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#7CFFA8',
            flexShrink: 0,
            marginTop: 5,
            boxShadow: streaming ? '0 0 0 3px rgba(124,255,168,0.22)' : 'none',
          }}
        />
        <span style={{ color: streaming ? '#7CFFA8' : '#e5e7eb', fontWeight: 500 }}>{text}</span>
      </div>
    );
  }

  if (line.kind === 'tool') {
    return (
      <div style={{ ...style, paddingLeft: 15 }}>
        <span style={{ color: '#6b7280', flexShrink: 0 }}>·</span>
        <span style={{ color: streaming ? '#cbd5e1' : '#9ca3af' }}>{text}</span>
      </div>
    );
  }

  if (line.kind === 'map') {
    // The induced business areas, rendered as chips so the viewer literally
    // sees the agent GROUP its exploration into business lines.
    const chips = line.text.split('·').map((c) => c.trim());
    return (
      <div style={{ ...style, paddingLeft: 15, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <span style={{ color: '#6b7280', flexShrink: 0 }}>·</span>
        {chips.map((chip) => (
          <span
            key={chip}
            style={{
              padding: '2px 8px',
              border: '1px solid rgba(124,255,168,0.35)',
              background: 'rgba(124,255,168,0.07)',
              borderRadius: 6,
              color: '#7CFFA8',
              fontSize: 11.5,
              lineHeight: 1.4,
            }}
          >
            {chip}
          </span>
        ))}
      </div>
    );
  }

  if (line.kind === 'wrote') {
    return (
      <div style={{ ...style, paddingLeft: 15 }}>
        <span style={{ color: '#7CFFA8', flexShrink: 0, fontWeight: 700 }}>✓</span>
        <span style={{ color: '#7CFFA8' }}>{text}</span>
      </div>
    );
  }

  // done
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 11px',
        border: '1px solid rgba(124,255,168,0.35)',
        background: 'rgba(124,255,168,0.05)',
        borderRadius: 9,
        animation: 'mcpdemo-in 0.22s ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, color: '#e5e7eb' }}>
        <span style={{ color: '#7CFFA8' }}>✓</span> Done
      </div>
      <div style={{ marginTop: 5, color: '#9ca3af', lineHeight: 1.5 }}>{line.text}</div>
    </div>
  );
}
