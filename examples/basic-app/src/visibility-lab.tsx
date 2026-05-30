/**
 * Visibility-drift lab — a reproducible scene for the v0.13 spec-emit
 * visibility prelude.
 *
 * Three buttons, each "drift-able" via a global toggle. When the toggle
 * is OFF, all three buttons render normally (a spec clicking them is
 * green). When the toggle is ON, each button gets hidden in a different
 * idiomatic way:
 *
 *   • Submit       → moved into a closed <details> (kebab-menu shape)
 *   • Apply coupon → `display: none` via class flip (the classic case)
 *   • Subscribe    → `visibility: hidden` (the rare "still takes layout
 *                    space but not visible" case)
 *
 * All three are still in the role tree — Playwright's getByRole resolves
 * them whether or not they're visible. That's the whole point of the
 * demo: the OLD emit (`page.getByRole(...).click()`) auto-waits on
 * actionability and eventually times out at 30 s with a generic
 * "element is not visible" message that reads like flake. The NEW
 * emit (`{ const el = ...; await expect(el).toBeVisible(); await el.click(); }`)
 * fails in ~5 s with "Locator expected to be visible" — the same
 * outcome, but categorically clear in CI logs.
 *
 * Toggle source of truth: URL query string `?drift=on`. Picked over
 * localStorage so Playwright (which boots a fresh context per test)
 * can deterministically drive the scene. The on-page toggle button
 * just flips the URL.
 *
 * See docs/faq.md ("My button is still in the DOM but moved behind a
 * kebab menu") for the full explanation.
 */
import { useEffect, useState } from 'react';

function useDriftMode(): [boolean, (next: boolean) => void] {
  const [drift, setDriftState] = useState(false);

  useEffect(() => {
    const sync = (): void => {
      const params = new URLSearchParams(window.location.search);
      setDriftState(params.get('drift') === 'on');
    };
    sync();
    // Keep state in lockstep with the URL — back/forward, manual edits,
    // hash router style updates all need to re-read.
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const setDrift = (next: boolean): void => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('drift', 'on');
    else url.searchParams.delete('drift');
    window.history.pushState({}, '', url.toString());
    setDriftState(next);
  };

  return [drift, setDrift];
}

export function VisibilityLab(): React.JSX.Element {
  const [drift, setDrift] = useDriftMode();
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const click = (which: string) => () => setLastClicked(which);

  return (
    <section className="panel" aria-labelledby="visibility-lab-heading" data-testid="visibility-lab">
      <header className="panel-head">
        <span className="panel-no">04</span>
        <h2 id="visibility-lab-heading">Visibility lab</h2>
        <span className={`panel-state ${drift ? 'on' : ''}`} data-testid="drift-state">
          {drift ? 'drift on' : 'drift off'}
        </span>
      </header>
      <div className="panel-body">
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>
          Three buttons that demonstrate the v0.13 spec-emit{' '}
          <strong>visibility prelude</strong>. Flip <strong>Drift mode</strong> on
          to hide each button in a different idiomatic way — they stay in the role
          tree, so <code>getByRole</code> still resolves them, but the user can't
          reach them. Saved Hover specs detect the drift in ~5 s with
          <code> Locator expected to be visible</code>; pre-v0.13 emit would have
          timed out at 30 s with a generic actionability error.
        </p>

        <button
          type="button"
          onClick={() => setDrift(!drift)}
          data-testid="drift-toggle"
          style={{
            padding: '6px 12px',
            border: '1px solid #d1d5db',
            background: drift ? '#fef3c7' : '#fff',
            borderColor: drift ? '#f59e0b' : '#d1d5db',
            color: drift ? '#92400e' : '#111',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 18,
          }}
        >
          Drift mode: {drift ? 'ON — buttons hidden' : 'OFF — buttons visible'}
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 1. <details> / kebab-menu shape */}
          <div data-testid="case-details">
            <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px' }}>
              Case 1 — moved into a closed <code>&lt;details&gt;</code> (kebab menu)
            </h3>
            {drift ? (
              <details data-testid="kebab">
                <summary style={{ cursor: 'pointer', padding: 6 }}>More actions</summary>
                <button className="btn-primary" onClick={click('Save changes')}>
                  Save changes
                </button>
              </details>
            ) : (
              <button className="btn-primary" onClick={click('Save changes')}>
                Save changes
              </button>
            )}
          </div>

          {/* 2. display: none */}
          <div data-testid="case-display-none">
            <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px' }}>
              Case 2 — <code>display: none</code> via class flip
            </h3>
            <button
              className="btn-primary"
              onClick={click('Apply coupon')}
              style={drift ? { display: 'none' } : undefined}
            >
              Apply coupon
            </button>
          </div>

          {/* 3. visibility: hidden */}
          <div data-testid="case-visibility-hidden">
            <h3 style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b7280', margin: '0 0 6px' }}>
              Case 3 — <code>visibility: hidden</code> (takes layout space)
            </h3>
            <button
              className="btn-primary"
              onClick={click('Subscribe')}
              style={drift ? { visibility: 'hidden' } : undefined}
            >
              Subscribe
            </button>
          </div>
        </div>

        {lastClicked && (
          <p
            data-testid="last-clicked"
            style={{ marginTop: 16, padding: '8px 12px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 6, fontSize: 13 }}
          >
            ✓ Last clicked: <strong>{lastClicked}</strong>
          </p>
        )}
      </div>
    </section>
  );
}
