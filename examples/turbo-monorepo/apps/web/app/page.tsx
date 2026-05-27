'use client';
import { useState } from 'react';

export default function Page() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
      <h1>turbo-monorepo / web</h1>
      <p>
        This is the <code>apps/web</code> workspace of a turbo + pnpm
        monorepo. Hover should be wired here (not at the repo root).
      </p>
      <p>
        <button
          type="button"
          onClick={() => setCount(c => c + 1)}
          style={{
            padding: '8px 16px',
            fontSize: 16,
            borderRadius: 6,
            border: '1px solid #ccc',
            cursor: 'pointer',
          }}
        >
          counter: {count}
        </button>
      </p>
      <p style={{ color: '#666', fontSize: 14 }}>
        Look for the floating ✨ in the bottom-right.
      </p>
    </main>
  );
}
