import type { ReactNode } from 'react';
import { HoverScript } from '@hover-dev/next';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#f5f5f5',
        }}
      >
        {children}
        <HoverScript />
      </body>
    </html>
  );
}
