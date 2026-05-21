import { useState } from 'react';
import { fmtPrice } from './fmt.ts';
import { STEPS, initial, type Form } from './types.ts';
import { VALIDATORS } from './validate.ts';
import {
  PersonalStep, AddressStep, EmploymentStep, FinancialStep,
  DisclosuresStep, FundingStep, ReviewStep,
} from './steps.tsx';

export default function App() {
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<Form | null>(null);

  function up<K extends keyof Form>(key: K, value: Form[K]) {
    setF(s => ({ ...s, [key]: value }));
  }

  function next() {
    const errs = VALIDATORS[step](f);
    setErrors(errs);
    if (errs.length > 0) {
      document.querySelector('.errors')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (step === STEPS.length - 1) {
      setSubmitted(f);
      return;
    }
    const n = step + 1;
    setStep(n);
    setMaxStep(prev => Math.max(prev, n));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    setErrors([]);
    setStep(s => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function jumpTo(target: number) {
    if (target > maxStep) return;
    setErrors([]);
    setStep(target);
  }

  function reset() {
    setF(initial);
    setStep(0);
    setMaxStep(0);
    setErrors([]);
    setSubmitted(null);
  }

  if (submitted) {
    const ref = 'SAB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    return (
      <div className="page">
        <BrandBar />
        <main className="success-shell">
          <section className="success" data-testid="success">
            <span className="success-mark">✓</span>
            <h1>Application submitted</h1>
            <p className="success-lede">
              Welcome, <strong data-testid="result-name">{submitted.firstName} {submitted.lastName}</strong>.
              A confirmation has been sent to <strong>{submitted.email}</strong>.
            </p>
            <dl className="success-meta">
              <div><dt>Reference</dt><dd><code data-testid="result-ref">{ref}</code></dd></div>
              <div><dt>Initial deposit</dt><dd>{fmtPrice(submitted.initialDeposit)} via {submitted.fundingSource}</dd></div>
              <div><dt>Estimated transfer</dt><dd>1 business day</dd></div>
            </dl>
            <button onClick={reset} className="btn-ghost">Open another account</button>
          </section>
        </main>
      </div>
    );
  }

  const current = STEPS[step];
  const StepComponent = STEP_COMPONENTS[step];

  return (
    <div className="page">
      <BrandBar />
      <main className="wizard">
        <div className="masthead">
          <p className="eyebrow">Open an account · individual taxable brokerage</p>
          <h1 className="display">Investing, on terms that are clearly yours.</h1>
        </div>

        <Stepper current={step} maxStep={maxStep} onJump={jumpTo} />

        <article className="step-card">
          <header>
            <span className="step-num">Step {step + 1} of {STEPS.length}</span>
            <h2>{current.title}</h2>
            <p className="step-blurb">{current.blurb}</p>
          </header>

          <div className="step-body">
            <StepComponent f={f} up={up} />
          </div>

          {errors.length > 0 && (
            <section className="errors" data-testid="errors">
              <strong>Please fix {errors.length} issue{errors.length === 1 ? '' : 's'} before continuing:</strong>
              <ul>{errors.map(err => <li key={err}>{err}</li>)}</ul>
            </section>
          )}

          <nav className="step-nav">
            <button onClick={back} className="btn-ghost" disabled={step === 0}>
              ← Back
            </button>
            <button
              onClick={next}
              className="btn-primary"
              data-testid={step === STEPS.length - 1 ? 'submit' : 'continue'}
            >
              {step === STEPS.length - 1 ? 'Submit application' : 'Continue'} →
            </button>
          </nav>
        </article>

        <p className="legal-foot">
          Securities offered through a fictional Hover Brokerage LLC. This form is
          a demonstration; no real account is opened.
        </p>
      </main>
    </div>
  );
}

const STEP_COMPONENTS = [
  PersonalStep, AddressStep, EmploymentStep, FinancialStep,
  DisclosuresStep, FundingStep, ReviewStep,
] as const;

function BrandBar() {
  return (
    <header className="brand-bar">
      <span className="brand">
        <span className="brand-mark">⌖</span>
        <span className="brand-name">Hover&nbsp;Brokerage</span>
      </span>
      <span className="brand-tag">EST. 2026 · MEMBER FINRA / SIPC*</span>
    </header>
  );
}

function Stepper({ current, maxStep, onJump }: { current: number; maxStep: number; onJump: (i: number) => void }) {
  return (
    <ol className="stepper" aria-label="application steps">
      {STEPS.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : i <= maxStep ? 'visited' : 'upcoming';
        const clickable = i <= maxStep;
        return (
          <li key={s.id} className={`step ${state}`}>
            <button
              type="button"
              onClick={() => clickable && onJump(i)}
              disabled={!clickable}
              data-testid={`step-${s.id}`}
              aria-current={i === current ? 'step' : undefined}
              aria-label={`go to step ${i + 1} ${s.label}`}
            >
              <span className="step-dot">
                {i < current ? '✓' : <span className="step-dot-num">{String(i + 1).padStart(2, '0')}</span>}
              </span>
              <span className="step-name">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
