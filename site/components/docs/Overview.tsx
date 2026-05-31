import Link from 'next/link';
import { DOCS_NAV } from '@/lib/docs-nav';

/** The /docs landing — replaces VitePress's home-layout index.md. A short
 *  intro + one card per section linking to its first page. */
export function DocsOverview() {
  return (
    <div>
      <h1 className="mb-3 font-mono text-[32px] font-semibold tracking-tight text-text md:text-[38px]">
        Documentation
      </h1>
      <p className="mb-10 max-w-2xl text-[16px] leading-relaxed text-text-mute">
        Everything you need to author end-to-end tests with Hover — from a
        60-second install to the plugin API. Hover drives your real Chrome from
        a chat widget, then crystallises the verified session into plain{' '}
        <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[14px] text-mint">
          @playwright/test
        </code>{' '}
        code.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOCS_NAV.map((section) => (
          <Link
            key={section.title}
            href={section.items[0].href}
            className="group rounded-lg border border-line bg-bg-2 p-5 transition-colors hover:border-[rgba(124,255,168,0.4)]"
          >
            <h2 className="mb-1.5 text-[16px] font-semibold tracking-tight text-text group-hover:text-mint">
              {section.title}
            </h2>
            <p className="text-[13px] leading-relaxed text-text-mute">
              {section.items
                .slice(1, 4)
                .map((i) => i.text)
                .join(' · ')}
              {section.items.length > 4 ? ' …' : ''}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
