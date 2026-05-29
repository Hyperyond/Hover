import { useEffect, useMemo, useState } from 'react';

// Origins that are allowed to receive postMessage results. In a real
// provider this would be the merchant's registered return URL.
const ALLOWED_RETURN_ORIGINS = [
  'http://localhost:5174', // examples/e-commerce store
];

const DEFAULT_MERCHANT = 'Hover Store';

// Mock OTP that always succeeds. A real provider sends an SMS; we just
// show it in the UI so the agent / human can read it off the page.
const MOCK_OTP = '123456';

type Step = 'card' | 'otp' | 'approved' | 'declined';

// Strip all non-digits and group in 4s for readability — same shape as
// Stripe Elements does. The form requires 16 digits to advance.
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D+/g, '').slice(0, 16);
  return digits.match(/.{1,4}/g)?.join(' ') ?? '';
}

function isValidCard(formatted: string): boolean {
  return formatted.replace(/\s+/g, '').length === 16;
}

function isValidCvv(raw: string): boolean {
  return /^\d{3,4}$/.test(raw.trim());
}

function isValidOtp(raw: string): boolean {
  return raw.trim() === MOCK_OTP;
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const ref = params.get('ref') ?? 'UNKNOWN';
  const amount = params.get('amount') ?? '$0';
  const merchant = params.get('merchant') ?? DEFAULT_MERCHANT;
  const returnOrigin = params.get('return') ?? ALLOWED_RETURN_ORIGINS[0];

  const [step, setStep] = useState<Step>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [cvv, setCvv] = useState('');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  // Simulated 600ms server-side card validation between Continue and the
  // OTP step. Stresses the agent's ability to wait for state transitions
  // rather than blasting through.
  const [submitting, setSubmitting] = useState(false);

  // Auto-close after success/decline so the original tab sees the
  // popup go away — this is the "tab disappears" condition Hover's
  // multi-tab system prompt teaches the agent to handle.
  useEffect(() => {
    if (step === 'approved' || step === 'declined') {
      const t = setTimeout(() => window.close(), 1500);
      return () => clearTimeout(t);
    }
  }, [step]);

  function postResult(status: 'approved' | 'declined') {
    const target = ALLOWED_RETURN_ORIGINS.includes(returnOrigin)
      ? returnOrigin
      : ALLOWED_RETURN_ORIGINS[0];
    try {
      window.opener?.postMessage(
        { type: 'payment-result', status, ref, amount },
        target,
      );
    } catch {
      /* opener closed or cross-origin restricted — fall through */
    }
  }

  function submitCard() {
    if (!isValidCard(cardNumber) || !isValidCvv(cvv)) return;
    setSubmitting(true);
    // Simulated server validation latency before moving to OTP — like a
    // real Stripe 3DS pre-check round-trip.
    setTimeout(() => {
      setSubmitting(false);
      setStep('otp');
    }, 600);
  }

  function submitOtp() {
    if (!isValidOtp(otp)) {
      setOtpError('Wrong code. The mock OTP is 123456.');
      return;
    }
    setOtpError(null);
    setStep('approved');
    postResult('approved');
  }

  function decline() {
    setStep('declined');
    postResult('declined');
  }

  const canSubmitCard = isValidCard(cardNumber) && isValidCvv(cvv) && !submitting;
  const canSubmitOtp = otp.trim().length === 6;

  return (
    <div className="provider">
      <header>
        <span className="logo">🔒 PayHover</span>
        <span className="env-badge">Sandbox</span>
      </header>

      <main>
        {step === 'card' && (
          <>
            <h1>Confirm payment</h1>
            <p className="merchant" data-testid="merchant">
              You are paying <strong>{merchant}</strong>
            </p>
            <div className="amount" data-testid="amount">{amount}</div>
            <dl>
              <dt>Reference</dt>
              <dd data-testid="ref">{ref}</dd>
            </dl>

            <form
              className="card-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitCard();
              }}
            >
              <label htmlFor="card-number">Card number</label>
              <input
                id="card-number"
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="4242 4242 4242 4242"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                data-testid="card-number"
                autoFocus
              />

              <label htmlFor="cvv">CVV</label>
              <input
                id="cvv"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="123"
                maxLength={4}
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D+/g, ''))}
                data-testid="cvv"
              />

              <div className="actions">
                <button
                  type="button"
                  onClick={decline}
                  className="decline"
                  data-testid="decline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="approve"
                  disabled={!canSubmitCard}
                  data-testid="continue"
                >
                  {submitting ? 'Verifying…' : `Continue to verify`}
                </button>
              </div>
            </form>

            <p className="footer-note">
              Sandbox: use card <code>4242 4242 4242 4242</code> with any 3-digit CVV.
              No real money moves. Window auto-closes on completion.
            </p>
          </>
        )}

        {step === 'otp' && (
          <>
            <h1>Verify it's you</h1>
            <p className="merchant">
              We sent a 6-digit code to the phone on file. (This is a sandbox —
              the code is always <strong>{MOCK_OTP}</strong>.)
            </p>

            <form
              className="otp-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitOtp();
              }}
            >
              <label htmlFor="otp">Verification code</label>
              <input
                id="otp"
                inputMode="numeric"
                placeholder="123456"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D+/g, ''));
                  if (otpError) setOtpError(null);
                }}
                data-testid="otp"
                autoFocus
              />
              {otpError && (
                <p className="error" data-testid="otp-error">{otpError}</p>
              )}

              <div className="actions">
                <button
                  type="button"
                  onClick={decline}
                  className="decline"
                  data-testid="decline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="approve"
                  disabled={!canSubmitOtp}
                  data-testid="confirm"
                >
                  Confirm payment
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'approved' && (
          <div className="result approved" data-testid="result-approved">
            <h1>✓ Payment approved</h1>
            <p>Returning you to the merchant…</p>
          </div>
        )}

        {step === 'declined' && (
          <div className="result declined" data-testid="result-declined">
            <h1>✗ Payment declined</h1>
            <p>Returning you to the merchant…</p>
          </div>
        )}
      </main>
    </div>
  );
}
