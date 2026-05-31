/**
 * Callout — the MDX replacement for VitePress's `::: tip/info/warning/danger`
 * containers. Styled with the site (= widget) token palette so docs match the
 * rest of gethover.dev. Injected via the MDX `components` map, so docs MDX
 * uses <Callout type="..."> with no import.
 */
type CalloutType = 'tip' | 'info' | 'warning' | 'danger' | 'details';

const STYLES: Record<CalloutType, { bar: string; label: string; defaultTitle: string }> = {
  tip:     { bar: 'var(--color-mint)',  label: 'text-mint',  defaultTitle: 'Tip' },
  info:    { bar: 'var(--color-link)',  label: 'text-link',  defaultTitle: 'Note' },
  warning: { bar: 'var(--color-warn)',  label: 'text-warn',  defaultTitle: 'Warning' },
  danger:  { bar: 'var(--color-error)', label: 'text-error', defaultTitle: 'Caution' },
  details: { bar: 'var(--color-text-dim)', label: 'text-text-mute', defaultTitle: 'Details' },
};

export function Callout({
  type = 'info',
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children?: React.ReactNode;
}) {
  const s = STYLES[type] ?? STYLES.info;
  return (
    <div
      className="my-5 rounded-lg border border-line bg-bg-2 px-4 py-3"
      style={{ borderLeft: `3px solid ${s.bar}` }}
    >
      <p className={`mb-1 text-[13px] font-semibold ${s.label}`}>
        {title || s.defaultTitle}
      </p>
      <div className="text-[14px] leading-relaxed text-text-mute [&_a]:text-link [&_a:hover]:underline [&_code]:rounded [&_code]:bg-bg-3 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-mint">
        {children}
      </div>
    </div>
  );
}
