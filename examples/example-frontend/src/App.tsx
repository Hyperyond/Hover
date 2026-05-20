import { useState, type FormEvent } from 'react';

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [todos, setTodos] = useState<string[]>(['Try Hover', 'Verify login flow']);
  const [draft, setDraft] = useState('');

  return (
    <main className="page">
      <h1>example-frontend</h1>
      <p className="subtitle">
        Target app for Hover smoke tests — login, counter, and a todo list cover
        the basic interaction primitives (form fill, click, read state).
      </p>

      <section aria-labelledby="auth-heading">
        <h2 id="auth-heading">Login</h2>
        {user ? (
          <div>
            <p>
              Welcome, <strong data-testid="welcome">{user}</strong>!
            </p>
            <button onClick={() => setUser(null)}>Log out</button>
          </div>
        ) : (
          <LoginForm onSubmit={setUser} />
        )}
      </section>

      <section aria-labelledby="counter-heading">
        <h2 id="counter-heading">Counter</h2>
        <p>
          Count: <strong data-testid="count">{count}</strong>
        </p>
        <button onClick={() => setCount(c => c + 1)}>+1</button>
        <button onClick={() => setCount(c => c - 1)}>-1</button>
        <button onClick={() => setCount(0)}>Reset</button>
      </section>

      <section aria-labelledby="todos-heading">
        <h2 id="todos-heading">Todos</h2>
        <ul data-testid="todo-list">
          {todos.map((t, i) => (
            <li key={`${i}-${t}`}>
              <span>{t}</span>
              <button
                onClick={() => setTodos(ts => ts.filter((_, j) => j !== i))}
                aria-label={`remove ${t}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (draft.trim()) {
              setTodos(ts => [...ts, draft.trim()]);
              setDraft('');
            }
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="New todo"
            aria-label="new todo"
          />
          <button type="submit">Add</button>
        </form>
      </section>
    </main>
  );
}

function LoginForm({ onSubmit }: { onSubmit: (user: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Invalid email');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }
    setError(null);
    onSubmit(email);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>
          Email:{' '}
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            aria-label="email"
          />
        </label>
      </div>
      <div>
        <label>
          Password:{' '}
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            aria-label="password"
          />
        </label>
      </div>
      {error && (
        <p data-testid="login-error" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      <button type="submit">Submit</button>
    </form>
  );
}
