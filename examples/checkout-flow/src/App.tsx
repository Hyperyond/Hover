import { useEffect, useState, type FormEvent } from 'react';

type Plan = 'basic' | 'pro' | 'enterprise';

interface CheckoutState {
  plan: Plan | null;
  account: { name: string; email: string };
  address: { street: string; city: string; state: string; zip: string };
  payment: { method: 'card' | 'external'; card: string; expiry: string; cvv: string; ref?: string };
}

const PAYMENT_PROVIDER_ORIGIN = 'http://localhost:5177';

const PLANS: { id: Plan; name: string; price: string; perks: string[] }[] = [
  { id: 'basic', name: 'Basic', price: '$9/mo', perks: ['1 user', '5 projects', 'Community support'] },
  { id: 'pro', name: 'Pro', price: '$29/mo', perks: ['5 users', 'Unlimited projects', 'Priority support'] },
  { id: 'enterprise', name: 'Enterprise', price: '$99/mo', perks: ['Unlimited users', 'SSO + audit log', 'Dedicated CSM'] },
];

const US_STATES = ['CA', 'NY', 'TX', 'WA', 'IL', 'MA', 'FL', 'OR'];

const STEPS = ['Plan', 'Account', 'Address', 'Payment', 'Review'] as const;

const emptyState: CheckoutState = {
  plan: null,
  account: { name: '', email: '' },
  address: { street: '', city: '', state: '', zip: '' },
  payment: { method: 'card', card: '', expiry: '', cvv: '' },
};

export default function App() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<CheckoutState>(emptyState);
  const [orderId, setOrderId] = useState<string | null>(null);

  if (orderId) {
    return (
      <main className="page">
        <h1>checkout-flow</h1>
        <section className="success" data-testid="success">
          <h2>Order confirmed</h2>
          <p>
            Reference: <strong data-testid="order-id">{orderId}</strong>
          </p>
          <button
            onClick={() => {
              setOrderId(null);
              setStep(0);
              setState(emptyState);
            }}
          >
            Start over
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>checkout-flow</h1>
      <p className="subtitle">
        5-step purchase wizard. Long action chain, state preservation across
        steps, conditional reveal on review.
      </p>

      <ol className="steps" aria-label="checkout steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={i === step ? 'active' : i < step ? 'done' : ''}
            data-testid={`step-${label.toLowerCase()}`}
            aria-current={i === step ? 'step' : undefined}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && <PlanStep state={state} setState={setState} onNext={() => setStep(1)} />}
      {step === 1 && (
        <AccountStep state={state} setState={setState} onNext={() => setStep(2)} onBack={() => setStep(0)} />
      )}
      {step === 2 && (
        <AddressStep state={state} setState={setState} onNext={() => setStep(3)} onBack={() => setStep(1)} />
      )}
      {step === 3 && (
        <PaymentStep state={state} setState={setState} onNext={() => setStep(4)} onBack={() => setStep(2)} />
      )}
      {step === 4 && (
        <ReviewStep
          state={state}
          onBack={() => setStep(3)}
          onConfirm={() => setOrderId('ORD-' + Math.random().toString(36).slice(2, 9).toUpperCase())}
        />
      )}
    </main>
  );
}

interface StepProps {
  state: CheckoutState;
  setState: React.Dispatch<React.SetStateAction<CheckoutState>>;
  onNext: () => void;
  onBack?: () => void;
}

function PlanStep({ state, setState, onNext }: StepProps) {
  return (
    <section aria-labelledby="plan-heading">
      <h2 id="plan-heading">Choose a plan</h2>
      <div className="plans">
        {PLANS.map(p => (
          <label key={p.id} className={`plan-card ${state.plan === p.id ? 'selected' : ''}`}>
            <input
              type="radio"
              name="plan"
              value={p.id}
              checked={state.plan === p.id}
              onChange={() => setState(s => ({ ...s, plan: p.id }))}
              aria-label={`${p.name} plan`}
            />
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">{p.price}</div>
            <ul>{p.perks.map(perk => <li key={perk}>{perk}</li>)}</ul>
          </label>
        ))}
      </div>
      <div className="actions">
        <button onClick={onNext} disabled={!state.plan}>Continue</button>
      </div>
    </section>
  );
}

function AccountStep({ state, setState, onNext, onBack }: StepProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (state.account.name && state.account.email.includes('@')) onNext();
  }
  return (
    <section aria-labelledby="account-heading">
      <h2 id="account-heading">Account info</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Full name
          <input
            type="text"
            value={state.account.name}
            onChange={e => setState(s => ({ ...s, account: { ...s.account, name: e.target.value } }))}
            aria-label="full name"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={state.account.email}
            onChange={e => setState(s => ({ ...s, account: { ...s.account, email: e.target.value } }))}
            aria-label="email"
          />
        </label>
        <div className="actions">
          <button type="button" onClick={onBack}>Back</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </section>
  );
}

function AddressStep({ state, setState, onNext, onBack }: StepProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { street, city, state: st, zip } = state.address;
    if (street && city && st && zip.length >= 5) onNext();
  }
  return (
    <section aria-labelledby="address-heading">
      <h2 id="address-heading">Shipping address</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Street
          <input
            type="text"
            value={state.address.street}
            onChange={e => setState(s => ({ ...s, address: { ...s.address, street: e.target.value } }))}
            aria-label="street"
          />
        </label>
        <label>
          City
          <input
            type="text"
            value={state.address.city}
            onChange={e => setState(s => ({ ...s, address: { ...s.address, city: e.target.value } }))}
            aria-label="city"
          />
        </label>
        <div className="row">
          <label>
            State
            <select
              value={state.address.state}
              onChange={e => setState(s => ({ ...s, address: { ...s.address, state: e.target.value } }))}
              aria-label="state"
            >
              <option value="">—</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            ZIP
            <input
              type="text"
              maxLength={5}
              value={state.address.zip}
              onChange={e => setState(s => ({ ...s, address: { ...s.address, zip: e.target.value } }))}
              aria-label="zip"
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={onBack}>Back</button>
          <button type="submit">Continue</button>
        </div>
      </form>
    </section>
  );
}

function PaymentStep({ state, setState, onNext, onBack }: StepProps) {
  const [providerStatus, setProviderStatus] = useState<'idle' | 'waiting' | 'declined'>('idle');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const { card, expiry, cvv } = state.payment;
    if (card.length >= 12 && /^\d{2}\/\d{2}$/.test(expiry) && cvv.length >= 3) {
      setState(s => ({ ...s, payment: { ...s.payment, method: 'card' } }));
      onNext();
    }
  }

  // Listen for postMessage from the payment-provider popup. Only accept
  // messages from the provider's origin — that's what makes this a real
  // cross-origin redirect simulation, not a same-origin shortcut.
  useEffect(() => {
    if (providerStatus !== 'waiting') return;
    const handler = (e: MessageEvent) => {
      if (e.origin !== PAYMENT_PROVIDER_ORIGIN) return;
      if (e.data?.type !== 'payment-result') return;
      if (e.data.status === 'approved') {
        setState(s => ({
          ...s,
          payment: { method: 'external', card: '', expiry: '', cvv: '', ref: e.data.ref },
        }));
        setProviderStatus('idle');
        onNext();
      } else {
        setProviderStatus('declined');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [providerStatus, onNext, setState]);

  function payWithProvider() {
    if (!state.plan) return;
    const ref = 'ORD-' + Math.random().toString(36).slice(2, 9).toUpperCase();
    const plan = PLANS.find(p => p.id === state.plan)!;
    const url = `${PAYMENT_PROVIDER_ORIGIN}/?ref=${encodeURIComponent(ref)}&amount=${encodeURIComponent(plan.price)}&return=${encodeURIComponent(location.origin)}`;
    const w = window.open(url, 'payhover-checkout', 'width=520,height=720');
    if (!w) {
      alert('Please allow pop-ups for this site to use the external payment provider.');
      return;
    }
    setProviderStatus('waiting');
  }

  return (
    <section aria-labelledby="payment-heading">
      <h2 id="payment-heading">Payment</h2>
      <form onSubmit={handleSubmit}>
        <label>
          Card number
          <input
            type="text"
            inputMode="numeric"
            value={state.payment.card}
            onChange={e => setState(s => ({ ...s, payment: { ...s.payment, card: e.target.value.replace(/\D/g, '') } }))}
            placeholder="1234 5678 9012 3456"
            aria-label="card number"
          />
        </label>
        <div className="row">
          <label>
            Expiry (MM/YY)
            <input
              type="text"
              maxLength={5}
              value={state.payment.expiry}
              onChange={e => setState(s => ({ ...s, payment: { ...s.payment, expiry: e.target.value } }))}
              placeholder="12/27"
              aria-label="expiry"
            />
          </label>
          <label>
            CVV
            <input
              type="text"
              maxLength={4}
              value={state.payment.cvv}
              onChange={e => setState(s => ({ ...s, payment: { ...s.payment, cvv: e.target.value.replace(/\D/g, '') } }))}
              aria-label="cvv"
            />
          </label>
        </div>
        <div className="actions">
          <button type="button" onClick={onBack}>Back</button>
          <button type="submit">Continue with card</button>
        </div>
      </form>

      <div className="divider"><span>or</span></div>

      <div className="provider-block">
        <p className="provider-blurb">
          Pay through <strong>PayHover</strong> — opens in a new tab.
          Tests cross-origin redirect, popup return via{' '}
          <code>window.opener.postMessage</code>.
        </p>
        <button
          type="button"
          onClick={payWithProvider}
          disabled={providerStatus === 'waiting'}
          className="provider-btn"
          data-testid="pay-with-provider"
          aria-label="pay with provider"
        >
          {providerStatus === 'waiting' ? '⏳ Waiting for provider…' : '🔒 Pay with PayHover →'}
        </button>
        {providerStatus === 'declined' && (
          <p className="provider-error" data-testid="provider-declined">
            Provider declined. You can try again or use a card.
          </p>
        )}
      </div>
    </section>
  );
}

function ReviewStep({ state, onBack, onConfirm }: { state: CheckoutState; onBack: () => void; onConfirm: () => void }) {
  const plan = PLANS.find(p => p.id === state.plan)!;
  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Review your order</h2>
      <dl className="review">
        <dt>Plan</dt>
        <dd data-testid="review-plan">{plan.name} — {plan.price}</dd>
        <dt>Name</dt>
        <dd data-testid="review-name">{state.account.name}</dd>
        <dt>Email</dt>
        <dd data-testid="review-email">{state.account.email}</dd>
        <dt>Shipping</dt>
        <dd data-testid="review-address">
          {state.address.street}, {state.address.city}, {state.address.state} {state.address.zip}
        </dd>
        <dt>Payment</dt>
        <dd data-testid="review-payment">
          {state.payment.method === 'external'
            ? `PayHover · ref ${state.payment.ref ?? '(unknown)'}`
            : `•••• •••• •••• ${state.payment.card.slice(-4)} (exp ${state.payment.expiry})`}
        </dd>
      </dl>
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button onClick={onConfirm} className="primary">Confirm order</button>
      </div>
    </section>
  );
}
