import { useState, type FormEvent } from 'react';
import {
  COUNTRIES, EXPERIENCE_LEVELS, FUNDING_SOURCES, INCOME_RANGES,
  INDUSTRIES, INVESTMENT_OBJECTIVES, INVESTMENT_TYPES,
  NET_WORTH_RANGES, SUFFIXES, TAX_BRACKETS, US_STATES,
} from './data.ts';

type YN = 'yes' | 'no' | '';
type Sex = 'male' | 'female' | 'other' | '';
type Marital = 'single' | 'married' | 'divorced' | 'widowed' | '';
type EmpStatus = 'employed' | 'self-employed' | 'retired' | 'student' | 'unemployed' | 'homemaker' | '';
type Risk = 'low' | 'moderate' | 'high' | 'aggressive' | '';
type AccountType = 'checking' | 'savings' | '';

interface Form {
  // Personal
  firstName: string; middleName: string; lastName: string; suffix: string;
  dob: string; sex: Sex; marital: Marital; dependents: number;
  citizenship: string; usTaxResident: YN;
  foreignTaxCountry: string; foreignTaxId: string;
  ssn: string; phone: string; email: string;
  // Address
  street: string; apt: string; city: string; state: string; zip: string;
  yearsAtAddress: number;
  prevStreet: string; prevCity: string; prevState: string; prevZip: string;
  // Employment
  empStatus: EmpStatus; employer: string; jobTitle: string;
  industry: string; yearsEmployed: number;
  // Financial profile
  annualIncome: string; liquidNetWorth: string; totalNetWorth: string;
  taxBracket: string; investmentObjective: string; riskTolerance: Risk;
  volatilityTolerance: number;
  // Experience
  expStocks: string; expOptions: string; expMargin: string;
  expBonds: string; expCrypto: string;
  interestedIn: string[];
  // Disclosures (FINRA rule 3210, control person, PEP)
  isPEP: YN; pepDetails: string;
  isFinraAffiliated: YN; finraEmployer: string;
  isControlPerson: YN; controlPersonCompany: string;
  // Funding
  initialDeposit: number; fundingSource: string;
  bankRouting: string; bankAccount: string; accountType: AccountType;
  // ID document
  govIdName: string | null;
  // Agreements
  agreeCustomer: boolean; agreeMargin: boolean; agreePrivacy: boolean;
  agreeElectronic: boolean; agreeAccurate: boolean; agreeMarketing: boolean;
}

const initial: Form = {
  firstName: '', middleName: '', lastName: '', suffix: '',
  dob: '', sex: '', marital: '', dependents: 0,
  citizenship: 'United States', usTaxResident: '',
  foreignTaxCountry: '', foreignTaxId: '',
  ssn: '', phone: '', email: '',
  street: '', apt: '', city: '', state: '', zip: '',
  yearsAtAddress: 0,
  prevStreet: '', prevCity: '', prevState: '', prevZip: '',
  empStatus: '', employer: '', jobTitle: '',
  industry: '', yearsEmployed: 0,
  annualIncome: '', liquidNetWorth: '', totalNetWorth: '',
  taxBracket: '', investmentObjective: '', riskTolerance: '',
  volatilityTolerance: 5,
  expStocks: 'None', expOptions: 'None', expMargin: 'None',
  expBonds: 'None', expCrypto: 'None',
  interestedIn: [],
  isPEP: '', pepDetails: '',
  isFinraAffiliated: '', finraEmployer: '',
  isControlPerson: '', controlPersonCompany: '',
  initialDeposit: 0, fundingSource: '',
  bankRouting: '', bankAccount: '', accountType: '',
  govIdName: null,
  agreeCustomer: false, agreeMargin: false, agreePrivacy: false,
  agreeElectronic: false, agreeAccurate: false, agreeMarketing: false,
};

function ageInYears(isoDate: string): number {
  if (!isoDate) return 0;
  const dob = new Date(isoDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function validate(f: Form): string[] {
  const errs: string[] = [];

  // Personal
  if (!f.firstName.trim()) errs.push('First name is required');
  if (!f.lastName.trim()) errs.push('Last name is required');
  if (!f.dob) errs.push('Date of birth is required');
  else if (ageInYears(f.dob) < 18) errs.push('You must be at least 18 years old');
  if (!f.sex) errs.push('Sex is required');
  if (!f.marital) errs.push('Marital status is required');
  if (!f.citizenship) errs.push('Country of citizenship is required');
  if (!f.usTaxResident) errs.push('US tax residency status is required');
  if (f.usTaxResident === 'no') {
    if (!f.foreignTaxCountry) errs.push('Foreign tax country is required');
    if (!f.foreignTaxId.trim()) errs.push('Foreign tax ID is required');
  }
  if (!/^\d{3}-?\d{2}-?\d{4}$/.test(f.ssn)) errs.push('SSN must be 9 digits (XXX-XX-XXXX)');
  if (!/^\d{10,}$/.test(f.phone.replace(/\D/g, ''))) errs.push('Phone must have at least 10 digits');
  if (!f.email.includes('@')) errs.push('Valid email is required');

  // Address
  if (!f.street.trim()) errs.push('Street is required');
  if (!f.city.trim()) errs.push('City is required');
  if (!f.state) errs.push('State is required');
  if (!/^\d{5}$/.test(f.zip)) errs.push('ZIP must be 5 digits');
  if (f.yearsAtAddress < 2 && f.yearsAtAddress >= 0) {
    if (!f.prevStreet.trim()) errs.push('Previous address required when at current < 2 years');
  }

  // Employment
  if (!f.empStatus) errs.push('Employment status is required');
  if (f.empStatus === 'employed' || f.empStatus === 'self-employed') {
    if (!f.employer.trim()) errs.push('Employer name is required');
    if (!f.jobTitle.trim()) errs.push('Job title is required');
    if (!f.industry) errs.push('Industry is required');
  }

  // Financial
  if (!f.annualIncome) errs.push('Annual income is required');
  if (!f.liquidNetWorth) errs.push('Liquid net worth is required');
  if (!f.totalNetWorth) errs.push('Total net worth is required');
  if (!f.taxBracket) errs.push('Tax bracket is required');
  if (!f.investmentObjective) errs.push('Investment objective is required');
  if (!f.riskTolerance) errs.push('Risk tolerance is required');

  // Disclosures
  if (!f.isPEP) errs.push('PEP disclosure is required');
  if (f.isPEP === 'yes' && !f.pepDetails.trim()) errs.push('PEP details are required');
  if (!f.isFinraAffiliated) errs.push('FINRA affiliation disclosure is required');
  if (f.isFinraAffiliated === 'yes' && !f.finraEmployer.trim()) errs.push('FINRA employer is required');
  if (!f.isControlPerson) errs.push('Control-person disclosure is required');
  if (f.isControlPerson === 'yes' && !f.controlPersonCompany.trim()) {
    errs.push('Control-person company is required');
  }

  // Funding
  if (!(f.initialDeposit > 0)) errs.push('Initial deposit must be greater than $0');
  if (!f.fundingSource) errs.push('Funding source is required');
  if (f.fundingSource === 'ACH bank transfer') {
    if (!/^\d{9}$/.test(f.bankRouting)) errs.push('Bank routing number must be 9 digits');
    if (!/^\d{4,17}$/.test(f.bankAccount)) errs.push('Bank account number must be 4-17 digits');
    if (!f.accountType) errs.push('Bank account type is required');
  }

  // ID document
  if (!f.govIdName) errs.push('Government ID photo is required');

  // Agreements
  if (!f.agreeCustomer) errs.push('You must accept the Customer Agreement');
  if (!f.agreePrivacy) errs.push('You must accept the Privacy Policy');
  if (!f.agreeElectronic) errs.push('You must consent to electronic delivery');
  if (!f.agreeAccurate) errs.push('You must confirm the information is accurate');

  return errs;
}

export default function App() {
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<Form | null>(null);

  function up<K extends keyof Form>(key: K, value: Form[K]) {
    setF(s => ({ ...s, [key]: value }));
  }

  function toggleInterest(t: string) {
    setF(s => ({
      ...s,
      interestedIn: s.interestedIn.includes(t)
        ? s.interestedIn.filter(x => x !== t)
        : [...s.interestedIn, t],
    }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(f);
    setErrors(errs);
    if (errs.length === 0) setSubmitted(f);
    else document.querySelector('.errors')?.scrollIntoView({ behavior: 'smooth' });
  }

  function reset() {
    setF(initial);
    setErrors([]);
    setSubmitted(null);
  }

  if (submitted) {
    return (
      <main className="page">
        <h1>stock-registration</h1>
        <section className="success" data-testid="success">
          <h2>✓ Application submitted</h2>
          <p>
            Welcome, <strong data-testid="result-name">{submitted.firstName} {submitted.lastName}</strong>.
          </p>
          <p>
            Reference: <code data-testid="result-ref">SAB-{Math.random().toString(36).slice(2, 8).toUpperCase()}</code>
          </p>
          <p className="muted">
            We will email <strong>{submitted.email}</strong> with next steps. Initial
            deposit of ${submitted.initialDeposit.toLocaleString()} via {submitted.fundingSource}{' '}
            will be initiated within 1 business day.
          </p>
          <button onClick={reset}>Open another account</button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>stock-registration</h1>
      <p className="subtitle">
        Realistic brokerage account opening form. ~50 fields across 8 sections,
        conditional reveals (foreign-tax fields, previous address, employer
        block, PEP/FINRA/control-person follow-ups, ACH bank fields), multi-
        select chips, file upload, range slider, compliance acknowledgements.
      </p>

      <form onSubmit={submit} noValidate>
        {/* ── Personal ─────────────────────────────────────────────── */}
        <section aria-labelledby="sec-personal">
          <h2 id="sec-personal">1 · Personal information</h2>
          <div className="grid-4">
            <label>First name<input type="text" value={f.firstName} onChange={e => up('firstName', e.target.value)} aria-label="first name" /></label>
            <label>Middle (optional)<input type="text" value={f.middleName} onChange={e => up('middleName', e.target.value)} aria-label="middle name" /></label>
            <label>Last name<input type="text" value={f.lastName} onChange={e => up('lastName', e.target.value)} aria-label="last name" /></label>
            <label>Suffix
              <select value={f.suffix} onChange={e => up('suffix', e.target.value)} aria-label="suffix">
                {SUFFIXES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-3">
            <label>Date of birth<input type="date" value={f.dob} onChange={e => up('dob', e.target.value)} aria-label="date of birth" /></label>
            <div>
              <span className="lbl">Sex</span>
              <div className="radios" role="radiogroup" aria-label="sex">
                {(['male', 'female', 'other'] as Sex[]).map(s => (
                  <label key={s}>
                    <input type="radio" name="sex" checked={f.sex === s} onChange={() => up('sex', s)} aria-label={`sex ${s}`} />
                    {s}
                  </label>
                ))}
              </div>
            </div>
            <label>Marital status
              <select value={f.marital} onChange={e => up('marital', e.target.value as Marital)} aria-label="marital status">
                <option value="">—</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </label>
          </div>
          <div className="grid-3">
            <label># dependents<input type="number" min={0} max={20} value={f.dependents} onChange={e => up('dependents', Number(e.target.value))} aria-label="dependents" /></label>
            <label>Country of citizenship
              <select value={f.citizenship} onChange={e => up('citizenship', e.target.value)} aria-label="citizenship">
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div>
              <span className="lbl">US tax resident?</span>
              <div className="radios" role="radiogroup" aria-label="us tax resident">
                <label><input type="radio" name="ustax" checked={f.usTaxResident === 'yes'} onChange={() => up('usTaxResident', 'yes')} aria-label="us tax resident yes" />Yes</label>
                <label><input type="radio" name="ustax" checked={f.usTaxResident === 'no'} onChange={() => up('usTaxResident', 'no')} aria-label="us tax resident no" />No</label>
              </div>
            </div>
          </div>
          {f.usTaxResident === 'no' && (
            <div className="grid-2 reveal" data-testid="foreign-tax-block">
              <label>Foreign tax country
                <select value={f.foreignTaxCountry} onChange={e => up('foreignTaxCountry', e.target.value)} aria-label="foreign tax country">
                  <option value="">—</option>
                  {COUNTRIES.filter(c => c !== 'United States').map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Foreign tax ID<input type="text" value={f.foreignTaxId} onChange={e => up('foreignTaxId', e.target.value)} aria-label="foreign tax id" /></label>
            </div>
          )}
          <div className="grid-3">
            <label>SSN
              <input type="text" placeholder="XXX-XX-XXXX" maxLength={11} value={f.ssn}
                onChange={e => up('ssn', e.target.value.replace(/[^\d-]/g, ''))} aria-label="ssn" />
            </label>
            <label>Phone<input type="tel" placeholder="(555) 123-4567" value={f.phone} onChange={e => up('phone', e.target.value)} aria-label="phone" /></label>
            <label>Email<input type="email" value={f.email} onChange={e => up('email', e.target.value)} aria-label="email" /></label>
          </div>
        </section>

        {/* ── Address ──────────────────────────────────────────────── */}
        <section aria-labelledby="sec-address">
          <h2 id="sec-address">2 · Mailing address</h2>
          <div className="grid-2">
            <label>Street<input type="text" value={f.street} onChange={e => up('street', e.target.value)} aria-label="street" /></label>
            <label>Apt / Suite (optional)<input type="text" value={f.apt} onChange={e => up('apt', e.target.value)} aria-label="apt" /></label>
          </div>
          <div className="grid-4">
            <label>City<input type="text" value={f.city} onChange={e => up('city', e.target.value)} aria-label="city" /></label>
            <label>State
              <select value={f.state} onChange={e => up('state', e.target.value)} aria-label="state">
                <option value="">—</option>
                {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>ZIP<input type="text" maxLength={5} value={f.zip} onChange={e => up('zip', e.target.value.replace(/\D/g, ''))} aria-label="zip" /></label>
            <label>Years at this address
              <input type="number" min={0} max={99} value={f.yearsAtAddress} onChange={e => up('yearsAtAddress', Number(e.target.value))} aria-label="years at address" />
            </label>
          </div>
          {f.yearsAtAddress >= 0 && f.yearsAtAddress < 2 && (
            <div className="reveal" data-testid="prev-address-block">
              <h3>Previous address</h3>
              <div className="grid-2">
                <label>Previous street<input type="text" value={f.prevStreet} onChange={e => up('prevStreet', e.target.value)} aria-label="previous street" /></label>
                <label>Previous city<input type="text" value={f.prevCity} onChange={e => up('prevCity', e.target.value)} aria-label="previous city" /></label>
              </div>
              <div className="grid-2">
                <label>Previous state
                  <select value={f.prevState} onChange={e => up('prevState', e.target.value)} aria-label="previous state">
                    <option value="">—</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>Previous ZIP<input type="text" maxLength={5} value={f.prevZip} onChange={e => up('prevZip', e.target.value.replace(/\D/g, ''))} aria-label="previous zip" /></label>
              </div>
            </div>
          )}
        </section>

        {/* ── Employment ───────────────────────────────────────────── */}
        <section aria-labelledby="sec-employment">
          <h2 id="sec-employment">3 · Employment</h2>
          <div>
            <span className="lbl">Employment status</span>
            <div className="radios wrap" role="radiogroup" aria-label="employment status">
              {(['employed', 'self-employed', 'retired', 'student', 'unemployed', 'homemaker'] as EmpStatus[]).map(s => (
                <label key={s}>
                  <input type="radio" name="emp" checked={f.empStatus === s} onChange={() => up('empStatus', s)} aria-label={`employment ${s}`} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          {(f.empStatus === 'employed' || f.empStatus === 'self-employed') && (
            <div className="reveal" data-testid="employer-block">
              <div className="grid-2">
                <label>Employer name<input type="text" value={f.employer} onChange={e => up('employer', e.target.value)} aria-label="employer" /></label>
                <label>Job title<input type="text" value={f.jobTitle} onChange={e => up('jobTitle', e.target.value)} aria-label="job title" /></label>
              </div>
              <div className="grid-2">
                <label>Industry
                  <select value={f.industry} onChange={e => up('industry', e.target.value)} aria-label="industry">
                    <option value="">—</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </label>
                <label>Years at this employer<input type="number" min={0} max={99} value={f.yearsEmployed} onChange={e => up('yearsEmployed', Number(e.target.value))} aria-label="years employed" /></label>
              </div>
            </div>
          )}
        </section>

        {/* ── Financial profile ────────────────────────────────────── */}
        <section aria-labelledby="sec-financial">
          <h2 id="sec-financial">4 · Financial profile</h2>
          <div className="grid-2">
            <label>Annual income
              <select value={f.annualIncome} onChange={e => up('annualIncome', e.target.value)} aria-label="annual income">
                <option value="">—</option>
                {INCOME_RANGES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label>Tax bracket
              <select value={f.taxBracket} onChange={e => up('taxBracket', e.target.value)} aria-label="tax bracket">
                <option value="">—</option>
                {TAX_BRACKETS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label>Liquid net worth
              <select value={f.liquidNetWorth} onChange={e => up('liquidNetWorth', e.target.value)} aria-label="liquid net worth">
                <option value="">—</option>
                {NET_WORTH_RANGES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <label>Total net worth
              <select value={f.totalNetWorth} onChange={e => up('totalNetWorth', e.target.value)} aria-label="total net worth">
                <option value="">—</option>
                {NET_WORTH_RANGES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label>Investment objective
              <select value={f.investmentObjective} onChange={e => up('investmentObjective', e.target.value)} aria-label="investment objective">
                <option value="">—</option>
                {INVESTMENT_OBJECTIVES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <div>
              <span className="lbl">Risk tolerance</span>
              <div className="radios wrap" role="radiogroup" aria-label="risk tolerance">
                {(['low', 'moderate', 'high', 'aggressive'] as Risk[]).map(r => (
                  <label key={r}>
                    <input type="radio" name="risk" checked={f.riskTolerance === r} onChange={() => up('riskTolerance', r)} aria-label={`risk ${r}`} />
                    {r}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <label>Volatility comfort (1 = avoid, 10 = embrace)
            <input type="range" min={1} max={10} value={f.volatilityTolerance} onChange={e => up('volatilityTolerance', Number(e.target.value))} aria-label="volatility tolerance" />
            <span data-testid="volatility-value">{f.volatilityTolerance}</span>
          </label>
        </section>

        {/* ── Experience ───────────────────────────────────────────── */}
        <section aria-labelledby="sec-experience">
          <h2 id="sec-experience">5 · Investment experience</h2>
          <div className="grid-5">
            {([
              ['Stocks', 'expStocks'],
              ['Options', 'expOptions'],
              ['Margin', 'expMargin'],
              ['Bonds', 'expBonds'],
              ['Crypto', 'expCrypto'],
            ] as const).map(([label, key]) => (
              <label key={key}>{label}
                <select value={f[key]} onChange={e => up(key, e.target.value)} aria-label={`experience ${label.toLowerCase()}`}>
                  {EXPERIENCE_LEVELS.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div>
            <span className="lbl">Interested in trading (check all that apply)</span>
            <div className="chips" role="group" aria-label="interested in">
              {INVESTMENT_TYPES.map(t => (
                <label key={t} className={`chip ${f.interestedIn.includes(t) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={f.interestedIn.includes(t)} onChange={() => toggleInterest(t)} aria-label={`interest ${t.toLowerCase()}`} />
                  {t}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* ── Disclosures ──────────────────────────────────────────── */}
        <section aria-labelledby="sec-disclosures">
          <h2 id="sec-disclosures">6 · Regulatory disclosures</h2>

          <YesNo
            label="Are you a politically exposed person, or a close family member of one?"
            value={f.isPEP}
            onChange={v => up('isPEP', v)}
            name="pep"
          />
          {f.isPEP === 'yes' && (
            <label className="reveal">Please describe your role
              <textarea rows={2} value={f.pepDetails} onChange={e => up('pepDetails', e.target.value)} aria-label="pep details" />
            </label>
          )}

          <YesNo
            label="Are you employed by or affiliated with a FINRA-registered broker-dealer?"
            value={f.isFinraAffiliated}
            onChange={v => up('isFinraAffiliated', v)}
            name="finra"
          />
          {f.isFinraAffiliated === 'yes' && (
            <label className="reveal">FINRA-registered employer
              <input type="text" value={f.finraEmployer} onChange={e => up('finraEmployer', e.target.value)} aria-label="finra employer" />
            </label>
          )}

          <YesNo
            label="Are you a 10%+ shareholder, officer, or director of a publicly-traded company?"
            value={f.isControlPerson}
            onChange={v => up('isControlPerson', v)}
            name="control"
          />
          {f.isControlPerson === 'yes' && (
            <label className="reveal">Company ticker / name
              <input type="text" value={f.controlPersonCompany} onChange={e => up('controlPersonCompany', e.target.value)} aria-label="control person company" />
            </label>
          )}
        </section>

        {/* ── Funding ──────────────────────────────────────────────── */}
        <section aria-labelledby="sec-funding">
          <h2 id="sec-funding">7 · Funding</h2>
          <div className="grid-2">
            <label>Initial deposit (USD)
              <input type="number" min={0} step={100} value={f.initialDeposit} onChange={e => up('initialDeposit', Number(e.target.value))} aria-label="initial deposit" />
            </label>
            <label>Funding source
              <select value={f.fundingSource} onChange={e => up('fundingSource', e.target.value)} aria-label="funding source">
                <option value="">—</option>
                {FUNDING_SOURCES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
          </div>
          {f.fundingSource === 'ACH bank transfer' && (
            <div className="reveal grid-3" data-testid="ach-block">
              <label>Routing number
                <input type="text" maxLength={9} value={f.bankRouting} onChange={e => up('bankRouting', e.target.value.replace(/\D/g, ''))} aria-label="bank routing" />
              </label>
              <label>Account number
                <input type="text" maxLength={17} value={f.bankAccount} onChange={e => up('bankAccount', e.target.value.replace(/\D/g, ''))} aria-label="bank account" />
              </label>
              <label>Account type
                <select value={f.accountType} onChange={e => up('accountType', e.target.value as AccountType)} aria-label="account type">
                  <option value="">—</option>
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                </select>
              </label>
            </div>
          )}
          <label>Government-issued photo ID
            <input type="file" accept="image/*,application/pdf"
              onChange={e => up('govIdName', e.target.files?.[0]?.name ?? null)}
              aria-label="government id" />
          </label>
          {f.govIdName && (
            <div className="muted" data-testid="gov-id-name">Selected: {f.govIdName}</div>
          )}
        </section>

        {/* ── Agreements ───────────────────────────────────────────── */}
        <section aria-labelledby="sec-agreements">
          <h2 id="sec-agreements">8 · Agreements</h2>
          <Check label="I have read and accept the Customer Agreement" required value={f.agreeCustomer} onChange={v => up('agreeCustomer', v)} aria="agree customer" />
          <Check label="I have read the Margin Disclosure" value={f.agreeMargin} onChange={v => up('agreeMargin', v)} aria="agree margin" />
          <Check label="I have read and accept the Privacy Policy" required value={f.agreePrivacy} onChange={v => up('agreePrivacy', v)} aria="agree privacy" />
          <Check label="I consent to electronic delivery of statements and disclosures" required value={f.agreeElectronic} onChange={v => up('agreeElectronic', v)} aria="agree electronic" />
          <Check label="I confirm the information provided above is accurate" required value={f.agreeAccurate} onChange={v => up('agreeAccurate', v)} aria="agree accurate" />
          <Check label="(Optional) I'd like to receive product updates by email" value={f.agreeMarketing} onChange={v => up('agreeMarketing', v)} aria="agree marketing" />
        </section>

        {errors.length > 0 && (
          <section className="errors" data-testid="errors">
            <strong>Please fix {errors.length} issue{errors.length === 1 ? '' : 's'}:</strong>
            <ul>{errors.map(err => <li key={err}>{err}</li>)}</ul>
          </section>
        )}

        <div className="actions">
          <button type="button" onClick={reset}>Reset</button>
          <button type="submit" className="primary" data-testid="submit">Submit application</button>
        </div>
      </form>
    </main>
  );
}

function YesNo({ label, value, onChange, name }: { label: string; value: YN; onChange: (v: YN) => void; name: string }) {
  return (
    <div className="yesno">
      <span className="yesno-label">{label}</span>
      <div className="radios" role="radiogroup" aria-label={name}>
        <label><input type="radio" name={name} checked={value === 'yes'} onChange={() => onChange('yes')} aria-label={`${name} yes`} />Yes</label>
        <label><input type="radio" name={name} checked={value === 'no'} onChange={() => onChange('no')} aria-label={`${name} no`} />No</label>
      </div>
    </div>
  );
}

function Check({ label, value, onChange, required, aria }: { label: string; value: boolean; onChange: (v: boolean) => void; required?: boolean; aria: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} aria-label={aria} />
      <span>{label}{required && <em className="req"> (required)</em>}</span>
    </label>
  );
}
