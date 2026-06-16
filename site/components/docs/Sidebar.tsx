'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from '@/lib/docs-nav';

/** Docs sidebar — sections + links, current page highlighted. Trailing
 *  slashes are normalised because the site uses trailingSlash:true. */
export function Sidebar() {
  const raw = usePathname() ?? '';
  const here = raw.replace(/\/$/, '') || '/docs';

  return (
    <nav className="text-[13.5px]">
      {DOCS_NAV.map((section) => (
        <div key={section.title} className="mb-6">
          <div className="mb-2 px-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-dim">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = here === item.href.replace(/\/$/, '');
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`block rounded-md px-2 py-1.5 transition-colors ${
                      active
                        ? 'bg-[rgba(124,255,168,0.1)] text-mint'
                        : 'text-text-mute hover:bg-bg-2 hover:text-text'
                    }`}
                  >
                    {item.text}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
