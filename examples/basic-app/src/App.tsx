import { useState, type FormEvent } from 'react';
import { WrapperLab } from './wrapper-lab';
import { VisibilityLab } from './visibility-lab';

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [todos, setTodos] = useState<string[]>(['Try Hover', 'Verify login flow']);
  const [draft, setDraft] = useState('');

  return (
    <main className="page">
      <header className="masthead">
        <div className="brand">
          <span className="brand-bar" aria-hidden="true" />
          <span className="brand-name">basic⁄app</span>
        </div>
        <p className="lede">
          A simple target for verifying Hover. Three primitives — auth, state,
          list — laid out as plainly as possible so misbehaviour is obvious.
        </p>
        <ul className="meta">
          <li><span>port</span><code>5173</code></li>
          <li><span>stack</span><code>vite · react 19 · ts</code></li>
          <li><span>controls</span><code>3 sections</code></li>
        </ul>
      </header>

      <section className="panel" aria-labelledby="auth-heading">
        <header className="panel-head">
          <span className="panel-no">01</span>
          <h2 id="auth-heading">Login</h2>
          <span className={`panel-state ${user ? 'on' : ''}`}>{user ? 'signed in' : 'signed out'}</span>
        </header>
        {user ? (
          <div className="panel-body welcome">
            <p>
              Welcome,&nbsp;<strong data-testid="welcome">{user}</strong>.
            </p>
            <button className="btn-secondary" onClick={() => setUser(null)}>Log out</button>
          </div>
        ) : (
          <div className="panel-body">
            <LoginForm onSubmit={setUser} />
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="counter-heading">
        <header className="panel-head">
          <span className="panel-no">02</span>
          <h2 id="counter-heading">Counter</h2>
          <span className="panel-state mono">state · {count}</span>
        </header>
        <div className="panel-body counter-body">
          <div className="counter-display" data-testid="count" aria-live="polite">
            {count.toString().padStart(2, '0')}
          </div>
          <div className="counter-actions">
            <button className="btn-primary" onClick={() => setCount(c => c + 1)}>+ 1</button>
            <button className="btn-secondary" onClick={() => setCount(c => c - 1)}>− 1</button>
            <button className="btn-ghost" onClick={() => setCount(0)}>Reset</button>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="todos-heading">
        <header className="panel-head">
          <span className="panel-no">03</span>
          <h2 id="todos-heading">Todos</h2>
          <span className="panel-state mono">{todos.length} item{todos.length === 1 ? '' : 's'}</span>
        </header>
        <div className="panel-body">
          <ul className="todos" data-testid="todo-list">
            {todos.map((t, i) => (
              <li key={`${i}-${t}`}>
                <span className="todo-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="todo-text">{t}</span>
                <button
                  className="todo-remove"
                  onClick={() => setTodos(ts => ts.filter((_, j) => j !== i))}
                  aria-label={`remove ${t}`}
                >
                  ×
                </button>
              </li>
            ))}
            {todos.length === 0 && (
              <li className="todos-empty">No items. Add one below.</li>
            )}
          </ul>
          <form
            className="todo-form"
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
            <button type="submit" className="btn-primary">Add</button>
          </form>
        </div>
      </section>

      <VisibilityLab />

      <WrapperLab />
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
    <form className="login-form" onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          aria-label="email"
          autoComplete="email"
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          aria-label="password"
          autoComplete="current-password"
        />
      </label>
      {error && (
        <p data-testid="login-error" className="login-error">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary">Submit →</button>
    </form>
  );
}
