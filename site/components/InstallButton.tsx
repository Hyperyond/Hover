/**
 * Primary install affordance — Hover ships as a VS Code extension, live on the
 * Marketplace, so the CTA points straight at the listing. `variant` switches
 * between the solid mint primary and a lower-key outline for secondary
 * placements.
 */

/** The VS Code Marketplace listing — the primary install affordance. */
export const MARKETPLACE_URL =
  'https://marketplace.visualstudio.com/items?itemName=hyperyond.hover-dev';

/** The install docs page (details / build-from-source). */
export const INSTALL_URL = '/docs/get-started/install';

export function InstallButton({
  variant = 'primary',
  label = 'Install the VS Code extension',
}: {
  variant?: 'primary' | 'outline';
  label?: string;
}) {
  const base =
    'group inline-flex items-center gap-2.5 rounded-md px-5 py-3 text-[14px] font-semibold transition-all';
  const cls =
    variant === 'primary'
      ? `${base} border border-[rgba(124,255,168,0.5)] bg-mint text-bg shadow-[0_4px_16px_rgba(0,0,0,0.35)] hover:bg-[#5cf094] hover:shadow-[0_4px_18px_rgba(124,255,168,0.28),0_4px_16px_rgba(0,0,0,0.4)]`
      : `${base} border border-line bg-bg-2 text-text-mute hover:border-line-2 hover:text-text`;

  return (
    <a href={MARKETPLACE_URL} target="_blank" rel="noopener noreferrer" className={cls}>
      <VSCodeGlyph />
      {label}
    </a>
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
