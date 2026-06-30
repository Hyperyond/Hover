'use client';

/**
 * Primary install affordance — Hover authors via its **MCP server**, so the CTA
 * is the one-command install of `@hover-dev/mcp` into the user's own coding
 * agent, rendered as a copyable code-pill. The VS Code extension is an optional
 * *review* cockpit, so it's a secondary outline link to the Marketplace.
 */

import { useState } from 'react';

/** The one-command MCP install — the primary affordance. */
export const MCP_INSTALL = 'claude mcp add hover -- npx -y @hover-dev/mcp';

/** npm package page for the MCP server. */
export const NPM_URL = 'https://www.npmjs.com/package/@hover-dev/mcp';

/** The VS Code Marketplace listing — the optional review cockpit. */
export const MARKETPLACE_URL =
  'https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev';

/** The install docs page (details / build-from-source). */
export const INSTALL_URL = '/docs/get-started/install/';

/**
 * Copyable code-pill for the MCP install command. This is the primary CTA: the
 * user pastes it into their own agent and the MCP is wired in.
 */
export function InstallButton({ command = MCP_INSTALL }: { command?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the text is still selectable */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy the Hover MCP install command"
      className="group inline-flex max-w-full items-center gap-3 rounded-md border border-[rgba(124,255,168,0.45)] bg-bg-2 py-3 pl-4 pr-3 text-left font-mono text-[13px] text-text shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-all hover:border-[rgba(124,255,168,0.7)]"
    >
      <span aria-hidden className="select-none text-mint">
        $
      </span>
      <code className="overflow-hidden text-ellipsis whitespace-nowrap text-text">{command}</code>
      <span
        aria-hidden
        className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-bg-3 text-text-mute transition-colors group-hover:border-line-2 group-hover:text-text"
      >
        {copied ? <CheckGlyph /> : <CopyGlyph />}
      </span>
    </button>
  );
}

/**
 * Secondary outline link to the VS Code Marketplace — the optional review
 * cockpit (Business Map + Dashboard), not the engine.
 */
export function CockpitButton({ label = 'Get the VS Code cockpit' }: { label?: string }) {
  return (
    <a
      href={MARKETPLACE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center gap-2.5 rounded-md border border-line bg-bg-2 px-5 py-3 text-[14px] font-medium text-text-mute transition-colors hover:border-line-2 hover:text-text"
    >
      <VSCodeGlyph />
      {label}
    </a>
  );
}

function CopyGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-mint)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* VS Code logo mark, single-colour so it inherits the button's text colour. */
function VSCodeGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
      <path d="M75.6 5.2 96 15v70l-20.4 9.8L42 66.2 18.8 84 4 77.4V22.6L18.8 16 42 33.8 75.6 5.2Zm-1 22.9L49.4 50l25.2 21.9V28.1ZM18.6 38.5v23L31.2 50 18.6 38.5Z" />
    </svg>
  );
}
