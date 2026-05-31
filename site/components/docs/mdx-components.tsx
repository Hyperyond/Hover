/**
 * MDX component map for docs pages — styles every markdown element with the
 * site token palette and routes internal links through next/link. Passed to
 * next-mdx-remote's <MDXRemote components={...} />.
 */
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { Callout } from './Callout';

function A({ href = '', children, ...rest }: ComponentProps<'a'>) {
  const internal = href.startsWith('/');
  if (internal) {
    return (
      <Link href={href} className="text-link underline-offset-2 hover:underline">
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-link underline-offset-2 hover:underline" {...rest}>
      {children}
    </a>
  );
}

export const mdxComponents = {
  Callout,
  h1: (p: ComponentProps<'h1'>) => (
    <h1 className="mt-2 mb-6 font-mono text-[30px] font-semibold tracking-tight text-text md:text-[36px]" {...p} />
  ),
  h2: (p: ComponentProps<'h2'>) => (
    <h2 className="mt-10 mb-4 scroll-mt-24 border-t border-line pt-8 font-mono text-[22px] font-semibold tracking-tight text-text" {...p} />
  ),
  h3: (p: ComponentProps<'h3'>) => (
    <h3 className="mt-7 mb-3 scroll-mt-24 text-[17px] font-semibold tracking-tight text-text" {...p} />
  ),
  h4: (p: ComponentProps<'h4'>) => (
    <h4 className="mt-5 mb-2 scroll-mt-24 text-[15px] font-semibold text-text" {...p} />
  ),
  p: (p: ComponentProps<'p'>) => (
    <p className="my-4 text-[15px] leading-[1.7] text-text-mute" {...p} />
  ),
  a: A,
  ul: (p: ComponentProps<'ul'>) => (
    <ul className="my-4 ml-5 list-disc space-y-2 text-[15px] leading-[1.7] text-text-mute marker:text-text-dim" {...p} />
  ),
  ol: (p: ComponentProps<'ol'>) => (
    <ol className="my-4 ml-5 list-decimal space-y-2 text-[15px] leading-[1.7] text-text-mute marker:text-text-dim" {...p} />
  ),
  li: (p: ComponentProps<'li'>) => <li className="pl-1" {...p} />,
  strong: (p: ComponentProps<'strong'>) => <strong className="font-semibold text-text" {...p} />,
  em: (p: ComponentProps<'em'>) => <em className="text-text-mute" {...p} />,
  blockquote: (p: ComponentProps<'blockquote'>) => (
    <blockquote className="my-5 border-l-2 border-line pl-4 text-text-mute italic" {...p} />
  ),
  hr: () => <hr className="my-8 border-line" />,
  // Inline code (block code goes through `pre`)
  code: (p: ComponentProps<'code'>) => (
    <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[13px] text-mint" {...p} />
  ),
  pre: (p: ComponentProps<'pre'>) => (
    <pre className="my-5 overflow-x-auto rounded-lg border border-line bg-bg-3 p-4 font-mono text-[13px] leading-relaxed text-text [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-text" {...p} />
  ),
  table: (p: ComponentProps<'table'>) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]" {...p} />
    </div>
  ),
  th: (p: ComponentProps<'th'>) => (
    <th className="border border-line bg-bg-2 px-3 py-2 text-left font-semibold text-text" {...p} />
  ),
  td: (p: ComponentProps<'td'>) => (
    <td className="border border-line px-3 py-2 align-top text-text-mute" {...p} />
  ),
  img: (p: ComponentProps<'img'>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="my-5 rounded-lg border border-line" {...p} alt={p.alt ?? ''} />
  ),
};
