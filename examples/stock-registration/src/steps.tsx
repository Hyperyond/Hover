// Step components for the brokerage-account wizard. Each step renders just
// its own fields — navigation buttons and validation summary live in App.tsx.

import type { Form, Sex, Marital, EmpStatus, Risk, AccountType, YN } from './types.ts';
import {
  COUNTRIES, EXPERIENCE_LEVELS, FUNDING_SOURCES, INCOME_RANGES,
  INDUSTRIES, INVESTMENT_OBJECTIVES, INVESTMENT_TYPES,
  NET_WORTH_RANGES, SUFFIXES, TAX_BRACKETS, US_STATES,
} from './data.ts';

type Up = <K extends keyof Form>(key: K, value: Form[K]) => void;
interface StepProps { f: Form; up: Up; }

// ─────────────────────────── helpers ──────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Radios<T extends string>({
  name, value, options, onChange, ariaLabel,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="radios" role="radiogroup" aria-label={ariaLabel}>
      {options.map(o => (
        <label key={o.value} className={`radio-card ${value === o.value ? 'selected' : ''}`}>
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            aria-label={`${ariaLabel} ${o.value}`}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function YesNo({
  label, value, onChange, name,
}: { label: string; value: YN; onChange: (v: YN) => void; name: string }) {
  return (
    <div className="yesno">
      <span className="yesno-label">{label}</span>
      <div className="radios tight" role="radiogroup" aria-label={name}>
        <label className={`radio-pill ${value === 'yes' ? 'selected' : ''}`}>
          <input type="radio" name={name} checked={value === 'yes'} onChange={() => onChange('yes')} aria-label={`${name} yes`} />
          Yes
        </label>
        <label className={`radio-pill ${value === 'no' ? 'selected' : ''}`}>
          <input type="radio" name={name} checked={value === 'no'} onChange={() => onChange('no')} aria-label={`${name} no`} />
          No
        </label>
      </div>
    </div>
  );
}

// ─────────────────────────── 1. Personal ──────────────────────────

export function PersonalStep({ f, up }: StepProps) {
  return (
    <>
      <div className="row-4">
        <Field label="First name">
          <input type="text" value={f.firstName} onChange={e => up('firstName', e.target.value)} aria-label="first name" />
        </Field>
        <Field label="Middle (optional)">
          <input type="text" value={f.middleName} onChange={e => up('middleName', e.target.value)} aria-label="middle name" />
        </Field>
        <Field label="Last name">
          <input type="text" value={f.lastName} onChange={e => up('lastName', e.target.value)} aria-label="last name" />
        </Field>
        <Field label="Suffix">
          <select value={f.suffix} onChange={e => up('suffix', e.target.value)} aria-label="suffix">
            {SUFFIXES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
          </select>
        </Field>
      </div>

      <div className="row-3">
        <Field label="Date of birth" hint="You must be 18 or older.">
          <input type="date" value={f.dob} onChange={e => up('dob', e.target.value)} aria-label="date of birth" />
        </Field>
        <Field label="Sex">
          <Radios
            name="sex"
            ariaLabel="sex"
            value={f.sex}
            options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] as { value: Sex; label: string }[]}
            onChange={v => up('sex', v)}
          />
        </Field>
        <Field label="Marital status">
          <select value={f.marital} onChange={e => up('marital', e.target.value as Marital)} aria-label="marital status">
            <option value="">Choose one</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </select>
        </Field>
      </div>

      <div className="row-3">
        <Field label="Dependents">
          <input type="number" min={0} max={20} value={f.dependents} onChange={e => up('dependents', Number(e.target.value))} aria-label="dependents" />
        </Field>
        <Field label="Country of citizenship">
          <select value={f.citizenship} onChange={e => up('citizenship', e.target.value)} aria-label="citizenship">
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="US tax resident?">
          <Radios
            name="ustax"
            ariaLabel="us tax resident"
            value={f.usTaxResident}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as { value: YN; label: string }[]}
            onChange={v => up('usTaxResident', v)}
          />
        </Field>
      </div>

      {f.usTaxResident === 'no' && (
        <div className="reveal" data-testid="foreign-tax-block">
          <p className="reveal-note">Required for the IRS Form W-8BEN we will file on your behalf.</p>
          <div className="row-2">
            <Field label="Foreign tax country">
              <select value={f.foreignTaxCountry} onChange={e => up('foreignTaxCountry', e.target.value)} aria-label="foreign tax country">
                <option value="">Choose one</option>
                {COUNTRIES.filter(c => c !== 'United States').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Foreign tax ID">
              <input type="text" value={f.foreignTaxId} onChange={e => up('foreignTaxId', e.target.value)} aria-label="foreign tax id" />
            </Field>
          </div>
        </div>
      )}

      <div className="row-3">
        <Field label="SSN" hint="Encrypted in transit. Required by the USA PATRIOT Act.">
          <input type="text" placeholder="XXX-XX-XXXX" maxLength={11} value={f.ssn}
            onChange={e => up('ssn', e.target.value.replace(/[^\d-]/g, ''))} aria-label="ssn" />
        </Field>
        <Field label="Phone">
          <input type="tel" placeholder="(555) 123-4567" value={f.phone} onChange={e => up('phone', e.target.value)} aria-label="phone" />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={e => up('email', e.target.value)} aria-label="email" />
        </Field>
      </div>
    </>
  );
}

// ─────────────────────────── 2. Address ───────────────────────────

export function AddressStep({ f, up }: StepProps) {
  return (
    <>
      <div className="row-2-3">
        <Field label="Street">
          <input type="text" value={f.street} onChange={e => up('street', e.target.value)} aria-label="street" />
        </Field>
        <Field label="Apt / Suite (optional)">
          <input type="text" value={f.apt} onChange={e => up('apt', e.target.value)} aria-label="apt" />
        </Field>
      </div>

      <div className="row-4">
        <Field label="City">
          <input type="text" value={f.city} onChange={e => up('city', e.target.value)} aria-label="city" />
        </Field>
        <Field label="State">
          <select value={f.state} onChange={e => up('state', e.target.value)} aria-label="state">
            <option value="">—</option>
            {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="ZIP">
          <input type="text" maxLength={5} value={f.zip} onChange={e => up('zip', e.target.value.replace(/\D/g, ''))} aria-label="zip" />
        </Field>
        <Field label="Years at this address">
          <input type="number" min={0} max={99} value={f.yearsAtAddress} onChange={e => up('yearsAtAddress', Number(e.target.value))} aria-label="years at address" />
        </Field>
      </div>

      {f.yearsAtAddress >= 0 && f.yearsAtAddress < 2 && (
        <div className="reveal" data-testid="prev-address-block">
          <p className="reveal-note">Required when you have lived at your current address less than 2 years.</p>
          <h3 className="reveal-title">Previous address</h3>
          <div className="row-2-3">
            <Field label="Previous street">
              <input type="text" value={f.prevStreet} onChange={e => up('prevStreet', e.target.value)} aria-label="previous street" />
            </Field>
            <Field label="Previous city">
              <input type="text" value={f.prevCity} onChange={e => up('prevCity', e.target.value)} aria-label="previous city" />
            </Field>
          </div>
          <div className="row-2">
            <Field label="Previous state">
              <select value={f.prevState} onChange={e => up('prevState', e.target.value)} aria-label="previous state">
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Previous ZIP">
              <input type="text" maxLength={5} value={f.prevZip} onChange={e => up('prevZip', e.target.value.replace(/\D/g, ''))} aria-label="previous zip" />
            </Field>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────── 3. Employment ────────────────────────

export function EmploymentStep({ f, up }: StepProps) {
  return (
    <>
      <Field label="Employment status">
        <div className="radios wrap" role="radiogroup" aria-label="employment status">
          {(['employed', 'self-employed', 'retired', 'student', 'unemployed', 'homemaker'] as EmpStatus[]).map(s => (
            <label key={s} className={`radio-card ${f.empStatus === s ? 'selected' : ''}`}>
              <input type="radio" name="emp" checked={f.empStatus === s} onChange={() => up('empStatus', s)} aria-label={`employment ${s}`} />
              <span className="capitalize">{s.replace('-', ' ')}</span>
            </label>
          ))}
        </div>
      </Field>

      {(f.empStatus === 'employed' || f.empStatus === 'self-employed') && (
        <div className="reveal" data-testid="employer-block">
          <div className="row-2">
            <Field label="Employer name">
              <input type="text" value={f.employer} onChange={e => up('employer', e.target.value)} aria-label="employer" />
            </Field>
            <Field label="Job title">
              <input type="text" value={f.jobTitle} onChange={e => up('jobTitle', e.target.value)} aria-label="job title" />
            </Field>
          </div>
          <div className="row-2">
            <Field label="Industry">
              <select value={f.industry} onChange={e => up('industry', e.target.value)} aria-label="industry">
                <option value="">Choose one</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Years at this employer">
              <input type="number" min={0} max={99} value={f.yearsEmployed} onChange={e => up('yearsEmployed', Number(e.target.value))} aria-label="years employed" />
            </Field>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────── 4. Financial ─────────────────────────

export function FinancialStep({ f, up }: StepProps) {
  function toggleInterest(t: string) {
    const next = f.interestedIn.includes(t)
      ? f.interestedIn.filter(x => x !== t)
      : [...f.interestedIn, t];
    up('interestedIn', next);
  }
  return (
    <>
      <div className="row-2">
        <Field label="Annual income">
          <select value={f.annualIncome} onChange={e => up('annualIncome', e.target.value)} aria-label="annual income">
            <option value="">Choose one</option>
            {INCOME_RANGES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Tax bracket">
          <select value={f.taxBracket} onChange={e => up('taxBracket', e.target.value)} aria-label="tax bracket">
            <option value="">Choose one</option>
            {TAX_BRACKETS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-2">
        <Field label="Liquid net worth" hint="Cash, securities, easily-sellable assets.">
          <select value={f.liquidNetWorth} onChange={e => up('liquidNetWorth', e.target.value)} aria-label="liquid net worth">
            <option value="">Choose one</option>
            {NET_WORTH_RANGES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Total net worth" hint="Including real estate, retirement, illiquid holdings.">
          <select value={f.totalNetWorth} onChange={e => up('totalNetWorth', e.target.value)} aria-label="total net worth">
            <option value="">Choose one</option>
            {NET_WORTH_RANGES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-2">
        <Field label="Investment objective">
          <select value={f.investmentObjective} onChange={e => up('investmentObjective', e.target.value)} aria-label="investment objective">
            <option value="">Choose one</option>
            {INVESTMENT_OBJECTIVES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Risk tolerance">
          <Radios
            name="risk"
            ariaLabel="risk tolerance"
            value={f.riskTolerance}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'moderate', label: 'Moderate' },
              { value: 'high', label: 'High' },
              { value: 'aggressive', label: 'Aggressive' },
            ] as { value: Risk; label: string }[]}
            onChange={v => up('riskTolerance', v)}
          />
        </Field>
      </div>
      <Field label={`Volatility comfort — ${f.volatilityTolerance} of 10`} hint="1 = avoid swings, 10 = embrace them.">
        <input
          type="range" min={1} max={10}
          value={f.volatilityTolerance}
          onChange={e => up('volatilityTolerance', Number(e.target.value))}
          aria-label="volatility tolerance"
        />
      </Field>

      <div className="block-title">Trading experience</div>
      <div className="row-5">
        {([
          ['Stocks', 'expStocks'],
          ['Options', 'expOptions'],
          ['Margin', 'expMargin'],
          ['Bonds', 'expBonds'],
          ['Crypto', 'expCrypto'],
        ] as const).map(([label, key]) => (
          <Field key={key} label={label}>
            <select value={f[key]} onChange={e => up(key, e.target.value)} aria-label={`experience ${label.toLowerCase()}`}>
              {EXPERIENCE_LEVELS.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
        ))}
      </div>

      <Field label="Interested in trading">
        <div className="chips" role="group" aria-label="interested in">
          {INVESTMENT_TYPES.map(t => (
            <label key={t} className={`chip ${f.interestedIn.includes(t) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={f.interestedIn.includes(t)}
                onChange={() => toggleInterest(t)}
                aria-label={`interest ${t.toLowerCase()}`}
              />
              {t}
            </label>
          ))}
        </div>
      </Field>
    </>
  );
}

// ─────────────────────────── 5. Disclosures ───────────────────────

export function DisclosuresStep({ f, up }: StepProps) {
  return (
    <>
      <YesNo
        label="Are you a politically-exposed person, or a close family member of one?"
        value={f.isPEP}
        onChange={v => up('isPEP', v)}
        name="pep"
      />
      {f.isPEP === 'yes' && (
        <Field label="Describe your role" hint="A short note is fine. Compliance may follow up.">
          <textarea rows={2} value={f.pepDetails} onChange={e => up('pepDetails', e.target.value)} aria-label="pep details" />
        </Field>
      )}

      <YesNo
        label="Are you employed by, or affiliated with, a FINRA-registered broker-dealer?"
        value={f.isFinraAffiliated}
        onChange={v => up('isFinraAffiliated', v)}
        name="finra"
      />
      {f.isFinraAffiliated === 'yes' && (
        <Field label="FINRA-registered employer">
          <input type="text" value={f.finraEmployer} onChange={e => up('finraEmployer', e.target.value)} aria-label="finra employer" />
        </Field>
      )}

      <YesNo
        label="Are you a 10%+ shareholder, officer, or director of a publicly-traded company?"
        value={f.isControlPerson}
        onChange={v => up('isControlPerson', v)}
        name="control"
      />
      {f.isControlPerson === 'yes' && (
        <Field label="Company ticker / name">
          <input type="text" value={f.controlPersonCompany} onChange={e => up('controlPersonCompany', e.target.value)} aria-label="control person company" />
        </Field>
      )}
    </>
  );
}

// ─────────────────────────── 6. Funding ───────────────────────────

export function FundingStep({ f, up }: StepProps) {
  return (
    <>
      <div className="row-2">
        <Field label="Initial deposit" hint="USD. You can add more later.">
          <input type="number" min={0} step={100} value={f.initialDeposit} onChange={e => up('initialDeposit', Number(e.target.value))} aria-label="initial deposit" />
        </Field>
        <Field label="Funding source">
          <select value={f.fundingSource} onChange={e => up('fundingSource', e.target.value)} aria-label="funding source">
            <option value="">Choose one</option>
            {FUNDING_SOURCES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>
      {f.fundingSource === 'ACH bank transfer' && (
        <div className="reveal row-3" data-testid="ach-block">
          <Field label="Routing number">
            <input type="text" maxLength={9} value={f.bankRouting} onChange={e => up('bankRouting', e.target.value.replace(/\D/g, ''))} aria-label="bank routing" />
          </Field>
          <Field label="Account number">
            <input type="text" maxLength={17} value={f.bankAccount} onChange={e => up('bankAccount', e.target.value.replace(/\D/g, ''))} aria-label="bank account" />
          </Field>
          <Field label="Account type">
            <select value={f.accountType} onChange={e => up('accountType', e.target.value as AccountType)} aria-label="account type">
              <option value="">—</option>
              <option value="checking">Checking</option>
              <option value="savings">Savings</option>
            </select>
          </Field>
        </div>
      )}
      <Field label="Government-issued photo ID" hint="Driver's license, passport, or state ID. JPG / PNG / PDF.">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={e => up('govIdName', e.target.files?.[0]?.name ?? null)}
          aria-label="government id"
        />
      </Field>
      {f.govIdName && (
        <div className="file-pill" data-testid="gov-id-name">
          📎 {f.govIdName}
        </div>
      )}
    </>
  );
}

// ─────────────────────────── 7. Review & submit ───────────────────

export function ReviewStep({ f, up }: StepProps) {
  return (
    <>
      <div className="summary">
        <SummaryRow k="Name" v={[f.firstName, f.middleName, f.lastName, f.suffix].filter(Boolean).join(' ')} />
        <SummaryRow k="Date of birth" v={f.dob} />
        <SummaryRow k="Citizenship" v={f.citizenship} />
        <SummaryRow k="US tax resident" v={f.usTaxResident === 'yes' ? 'Yes' : 'No'} />
        {f.usTaxResident === 'no' && <SummaryRow k="Foreign tax" v={`${f.foreignTaxCountry} · ${f.foreignTaxId}`} />}
        <SummaryRow k="SSN" v={maskSsn(f.ssn)} />
        <SummaryRow k="Phone / email" v={`${f.phone} · ${f.email}`} />
        <SummaryRow k="Address" v={`${f.street}${f.apt ? ', ' + f.apt : ''}, ${f.city}, ${f.state} ${f.zip}`} />
        <SummaryRow k="Employment" v={f.empStatus + (f.employer ? ` at ${f.employer}` : '')} />
        <SummaryRow k="Income / NW" v={`${f.annualIncome} · ${f.totalNetWorth}`} />
        <SummaryRow k="Risk profile" v={`${f.riskTolerance} · ${f.investmentObjective} · vol ${f.volatilityTolerance}/10`} />
        <SummaryRow k="Interests" v={f.interestedIn.join(', ') || '(none)'} />
        <SummaryRow k="Disclosures" v={`PEP ${f.isPEP || '—'} · FINRA ${f.isFinraAffiliated || '—'} · Control ${f.isControlPerson || '—'}`} />
        <SummaryRow k="Funding" v={`$${f.initialDeposit.toLocaleString()} via ${f.fundingSource}`} />
        <SummaryRow k="ID document" v={f.govIdName ?? '(missing)'} />
      </div>

      <div className="agreements">
        <Check label="I have read and accept the Customer Agreement"            required value={f.agreeCustomer}   onChange={v => up('agreeCustomer', v)}   aria="agree customer" />
        <Check label="I have read the Margin Disclosure"                                   value={f.agreeMargin}     onChange={v => up('agreeMargin', v)}     aria="agree margin" />
        <Check label="I have read and accept the Privacy Policy"                  required value={f.agreePrivacy}    onChange={v => up('agreePrivacy', v)}    aria="agree privacy" />
        <Check label="I consent to electronic delivery of statements and disclosures" required value={f.agreeElectronic} onChange={v => up('agreeElectronic', v)} aria="agree electronic" />
        <Check label="I confirm the information provided above is accurate"       required value={f.agreeAccurate}   onChange={v => up('agreeAccurate', v)}   aria="agree accurate" />
        <Check label="(Optional) I'd like to receive product updates by email"             value={f.agreeMarketing}   onChange={v => up('agreeMarketing', v)}  aria="agree marketing" />
      </div>
    </>
  );
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="summary-row">
      <dt>{k}</dt>
      <dd>{v || <em className="dim">—</em>}</dd>
    </div>
  );
}

function maskSsn(ssn: string): string {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '•••••••••';
  return '•••-••-' + digits.slice(-4);
}

function Check({ label, value, onChange, required, aria }: { label: string; value: boolean; onChange: (v: boolean) => void; required?: boolean; aria: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} aria-label={aria} />
      <span>{label}{required && <em className="req"> · required</em>}</span>
    </label>
  );
}
