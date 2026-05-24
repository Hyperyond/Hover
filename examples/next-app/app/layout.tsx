import type { ReactNode } from 'react';
import { HoverScript } from '@hover-dev/next';

export const metadata = {
  title: 'Hover · Next example',
  description: 'Counter + todos smoke target for @hover-dev/next.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 640,
          margin: '2rem auto',
          padding: '0 1rem',
        }}
      >
        {children}
        <HoverScript />
      </body>
    </html>
  );
}
