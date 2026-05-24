'use client';

import { useState } from 'react';

export default function Page() {
  const [count, setCount] = useState(0);
  const [todos, setTodos] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  function addTodo(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setTodos(prev => [...prev, text]);
    setDraft('');
  }

  return (
    <main>
      <h1>Hover · Next example</h1>
      <p>
        Smoke target for <code>@hover-dev/next</code>. Service starts via
        <code> instrumentation.ts</code>; widget injects via
        <code> &lt;HoverScript /&gt; </code> in <code>app/layout.tsx</code>.
      </p>

      <section style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
        <h2>Counter</h2>
        <p>
          Count: <span>{count}</span>
        </p>
        <button style={{ padding: '0.4rem 0.8rem', marginRight: '0.5rem' }} onClick={() => setCount(c => c + 1)}>
          +1
        </button>
        <button style={{ padding: '0.4rem 0.8rem' }} onClick={() => setCount(0)}>
          Reset
        </button>
      </section>

      <section style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
        <h2>Todos</h2>
        <form onSubmit={addTodo}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="What needs doing?"
            style={{ padding: '0.4rem', marginRight: '0.5rem' }}
          />
          <button type="submit" style={{ padding: '0.4rem 0.8rem' }}>
            Add
          </button>
        </form>
        <ul>
          {todos.map((t, i) => (
            <li key={i} style={{ margin: '0.2rem 0' }}>
              {t}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
