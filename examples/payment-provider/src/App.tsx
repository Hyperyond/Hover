import { useMemo, useState } from 'react';

// Origins that are allowed to receive postMessage results. In a real
// provider this would be the merchant's registered return URL.
const ALLOWED_RETURN_ORIGINS = [
  'http://localhost:5174', // checkout-flow
];

type Status = 'pending' | 'approved' | 'declined';

export default function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const ref = params.get('ref') ?? 'UNKNOWN';
  const amount = params.get('amount') ?? '$0';
  const returnOrigin = params.get('return') ?? ALLOWED_RETURN_ORIGINS[0];

  const [status, setStatus] = useState<Status>('pending');

  function postResult(status: 'approved' | 'declined') {
    const target = ALLOWED_RETURN_ORIGINS.includes(returnOrigin) ? returnOrigin : ALLOWED_RETURN_ORIGINS[0];
    try {
      window.opener?.postMessage(
        { type: 'payment-result', status, ref, amount },
        target,
      );
    } catch {
      /* opener closed or cross-origin restricted — fall through */
    }
  }

  function approve() {
    setStatus('approved');
    postResult('approved');
    setTimeout(() => window.close(), 1500);
  }

  function decline() {
    setStatus('declined');
    postResult('declined');
    setTimeout(() => window.close(), 1500);
  }

  return (
    <div className="provider">
      <header>
        <span className="logo">🔒 PayHover</span>
        <span className="env-badge">Sandbox</span>
      </header>

      <main>
        {status === 'pending' && (
          <>
            <h1>Confirm payment</h1>
            <p className="merchant">You are paying Hover Inc.</p>
            <div className="amount" data-testid="amount">{amount}</div>
            <dl>
              <dt>Reference</dt>
              <dd data-testid="ref">{ref}</dd>
              <dt>Card on file</dt>
              <dd>•••• 4242</dd>
            </dl>
            <div className="actions">
              <button onClick={decline} className="decline" data-testid="decline">
                Decline
              </button>
              <button onClick={approve} className="approve" data-testid="approve" autoFocus>
                Approve $
              </button>
            </div>
            <p className="footer-note">
              This is a sandbox provider for testing cross-tab payment flows.
              No real money moves. Window will auto-close after a decision.
            </p>
          </>
        )}
        {status === 'approved' && (
          <div className="result approved" data-testid="result-approved">
            <h1>✓ Payment approved</h1>
            <p>Returning you to the merchant...</p>
          </div>
        )}
        {status === 'declined' && (
          <div className="result declined" data-testid="result-declined">
            <h1>✗ Payment declined</h1>
            <p>Returning you to the merchant...</p>
          </div>
        )}
      </main>
    </div>
  );
}
