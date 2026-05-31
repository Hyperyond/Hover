/**
 * The Hover mark — the exact four-point sparkle the widget launcher draws
 * in every dev page's bottom-right corner (paths copied verbatim from
 * packages/widget-bootstrap/src/widget/template.html). Reusing it here means
 * a visitor who has seen the widget recognises the brand instantly.
 */
export function Sparkle({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M10 2v6M10 12v6M2 10h6M12 10h6" />
      <path
        d="M4.5 4.5l2 2M13.5 13.5l2 2M4.5 15.5l2-2M13.5 6.5l2-2"
        opacity={0.55}
      />
    </svg>
  );
}
