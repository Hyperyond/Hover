'use client';

import { useState } from 'react';

/**
 * The install command, shown verbatim and click-to-copy. The command is short
 * enough to display in full — copying is the affordance, not a reveal. Mirrors
 * the widget's mint-bordered, dark-inset code surface.
 */
export function CopyCommand({ command = 'npx @hover-dev/cli add' }: { command?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (insecure context / older browser) — no-op;
      // the command stays visible for manual selection.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy: ${command}`}
      className="group flex items-center gap-3 rounded-md border border-[rgba(124,255,168,0.5)] bg-bg px-5 py-3 font-mono text-[14px] text-mint shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-all hover:border-[rgba(124,255,168,0.9)] hover:shadow-[0_4px_18px_rgba(124,255,168,0.28),0_4px_16px_rgba(0,0,0,0.4)]"
    >
      <span className="select-none text-text-dim">$</span>
      <span>{command}</span>
      <span className="ml-1 text-text-dim transition-colors group-hover:text-mint">
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 8.5l3.2 3.2L13 5" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M3.5 10.5A1.5 1.5 0 0 1 2 9V3.5A1.5 1.5 0 0 1 3.5 2H9a1.5 1.5 0 0 1 1.5 1.5" />
          </svg>
        )}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}
